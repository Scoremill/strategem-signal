/**
 * Pre-generate all narratives and store in DB for instant loading.
 * Run after scoring pipeline or on weekly schedule.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  geographies,
  demandCapacityScores,
  permitData,
  employmentData,
  tradeCapacityData,
  narratives,
  fetchLogs,
} from "@/lib/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { generateMarketNarrative } from "@/lib/narrative";
import { generatePortfolioNarrative } from "@/lib/portfolio-narrative";
import { generateBuilderImplications } from "@/lib/capacity-narrative";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCron = auth && cronSecret && auth === `Bearer ${cronSecret}`;
  const cookie = request.cookies.get("ss_session")?.value;
  if (!isCron && !cookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const errors: string[] = [];
  let generated = 0;

  try {
    // Gather all market data
    const markets = await db.select().from(geographies).where(eq(geographies.isActive, true));

    const latestScoreDate = await db.select({ maxDate: sql<string>`MAX(score_date)` }).from(demandCapacityScores);
    const scores = latestScoreDate[0]?.maxDate
      ? await db.select().from(demandCapacityScores).where(eq(demandCapacityScores.scoreDate, latestScoreDate[0].maxDate))
      : [];

    const latPermits = await db
      .select({ geographyId: permitData.geographyId, totalPermits: permitData.totalPermits })
      .from(permitData)
      .where(sql`(${permitData.geographyId}, ${permitData.periodDate}) IN (SELECT geography_id, MAX(period_date) FROM permit_data GROUP BY geography_id)`);

    const latEmp = await db
      .select({ geographyId: employmentData.geographyId, totalNonfarm: employmentData.totalNonfarm, unemploymentRate: employmentData.unemploymentRate })
      .from(employmentData)
      .where(sql`(${employmentData.geographyId}, ${employmentData.periodDate}) IN (SELECT geography_id, MAX(period_date) FROM employment_data GROUP BY geography_id)`);

    const latUR = await db
      .select({ geographyId: employmentData.geographyId, unemploymentRate: employmentData.unemploymentRate })
      .from(employmentData)
      .where(sql`${employmentData.unemploymentRate} IS NOT NULL AND (${employmentData.geographyId}, ${employmentData.periodDate}) IN (SELECT geography_id, MAX(period_date) FROM employment_data WHERE unemployment_rate IS NOT NULL GROUP BY geography_id)`);

    const tradeCap = await db
      .select({
        geographyId: tradeCapacityData.geographyId,
        totalWorkers: sql<number>`SUM(avg_monthly_employment)`,
        avgWage: sql<number>`ROUND(AVG(CAST(avg_weekly_wage AS numeric)))`,
        avgWageYoy: sql<number>`ROUND(AVG(CAST(wage_yoy_change_pct AS numeric)), 1)`,
        totalEstabs: sql<number>`SUM(establishment_count)`,
      })
      .from(tradeCapacityData)
      .where(sql`${tradeCapacityData.periodDate} = (SELECT MAX(period_date) FROM trade_capacity_data)`)
      .groupBy(tradeCapacityData.geographyId);

    const scoreMap = new Map(scores.map((s) => [s.geographyId, s]));
    const permitMap = new Map(latPermits.map((p) => [p.geographyId, p]));
    const empMap = new Map(latEmp.map((e) => [e.geographyId, e]));
    const urMap = new Map(latUR.map((u) => [u.geographyId, u.unemploymentRate]));
    const tradeMap = new Map(tradeCap.map((t) => [t.geographyId, t]));

    // Clear existing narratives
    await db.delete(narratives);

    // 1. Generate per-market narratives
    console.log("[cron/narratives] Generating market narratives...");
    for (const market of markets) {
      const s = scoreMap.get(market.id);
      const t = tradeMap.get(market.id);
      if (!s) continue;

      try {
        const narrative = await generateMarketNarrative({
          name: market.shortName,
          state: market.state,
          demandIndex: parseFloat(String(s.demandIndex)),
          capacityIndex: parseFloat(String(s.capacityIndex)),
          ratio: parseFloat(String(s.demandCapacityRatio)),
          status: s.status,
          permits: permitMap.get(market.id)?.totalPermits ?? null,
          employment: empMap.get(market.id)?.totalNonfarm ?? null,
          unemploymentRate: urMap.get(market.id) ? parseFloat(String(urMap.get(market.id))) : null,
          tradeWorkers: t ? Number(t.totalWorkers) : null,
          wageGrowthYoy: t ? Number(t.avgWageYoy) : null,
          establishments: t ? Number(t.totalEstabs) : null,
        });

        await db.insert(narratives).values({
          id: randomUUID(),
          type: "market",
          geographyId: market.id,
          fullNarrative: narrative.full,
          snippet: narrative.snippet,
        });
        generated++;
        console.log(`  ✓ ${market.shortName}`);

        // Small delay between OpenAI calls
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        errors.push(`market/${market.shortName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Generate portfolio narrative
    console.log("[cron/narratives] Generating portfolio narrative...");
    try {
      const portfolioMarkets = markets
        .filter((m) => scoreMap.has(m.id))
        .map((m) => {
          const s = scoreMap.get(m.id)!;
          const t = tradeMap.get(m.id);
          return {
            name: m.shortName,
            state: m.state,
            demandIndex: parseFloat(String(s.demandIndex)),
            capacityIndex: parseFloat(String(s.capacityIndex)),
            ratio: parseFloat(String(s.demandCapacityRatio)),
            status: s.status,
            permits: permitMap.get(m.id)?.totalPermits ?? null,
            tradeWorkers: t ? Number(t.totalWorkers) : null,
            wageGrowthYoy: t ? Number(t.avgWageYoy) : null,
            establishments: t ? Number(t.totalEstabs) : null,
            unemploymentRate: urMap.get(m.id) ? parseFloat(String(urMap.get(m.id))) : null,
          };
        });

      const portfolio = await generatePortfolioNarrative(portfolioMarkets);

      await db.insert(narratives).values({
        id: randomUUID(),
        type: "portfolio",
        geographyId: null,
        fullNarrative: portfolio.summary,
        metadata: JSON.stringify({ topPicks: portfolio.topPicks, watchList: portfolio.watchList }),
      });
      generated++;
      console.log("  ✓ Portfolio");
    } catch (err) {
      errors.push(`portfolio: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 3. Generate capacity implications
    console.log("[cron/narratives] Generating capacity implications...");
    try {
      const capMarkets = markets
        .filter((m) => tradeMap.has(m.id) && scoreMap.has(m.id))
        .map((m) => {
          const t = tradeMap.get(m.id)!;
          const s = scoreMap.get(m.id)!;
          return {
            name: m.shortName,
            state: m.state,
            tradeWorkers: Number(t.totalWorkers),
            establishments: Number(t.totalEstabs),
            avgWeeklyWage: Number(t.avgWage),
            wageGrowthYoy: Number(t.avgWageYoy),
            ratio: parseFloat(String(s.demandCapacityRatio)),
            status: s.status,
            permits: permitMap.get(m.id)?.totalPermits ?? null,
          };
        });

      const implications = await generateBuilderImplications(capMarkets);

      await db.insert(narratives).values({
        id: randomUUID(),
        type: "capacity",
        geographyId: null,
        metadata: JSON.stringify({ implications }),
      });
      generated++;
      console.log("  ✓ Capacity implications");
    } catch (err) {
      errors.push(`capacity: ${err instanceof Error ? err.message : String(err)}`);
    }

    const durationMs = Date.now() - startTime;

    await db.insert(fetchLogs).values({
      id: randomUUID(),
      pipeline: "narratives",
      recordsFetched: generated,
      recordsNew: generated,
      errors: errors.length > 0 ? JSON.stringify(errors) : null,
      durationMs,
    });

    return NextResponse.json({ ok: true, generated, errors, durationMs });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
