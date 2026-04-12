import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { geographies, demandCapacityScores, permitData, employmentData, tradeCapacityData } from "@/lib/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { generatePortfolioNarrative } from "@/lib/portfolio-narrative";

// Cache for 6 hours
let cache: { data: unknown; generatedAt: number } | null = null;
const CACHE_TTL = 6 * 60 * 60 * 1000;

export async function GET() {
  if (cache && Date.now() - cache.generatedAt < CACHE_TTL) {
    return NextResponse.json({ ...cache.data as Record<string, unknown>, cached: true });
  }

  const markets = await db.select().from(geographies).where(eq(geographies.isActive, true));

  const latestScoreDate = await db.select({ maxDate: sql<string>`MAX(score_date)` }).from(demandCapacityScores);
  const scores = latestScoreDate[0]?.maxDate
    ? await db.select().from(demandCapacityScores).where(eq(demandCapacityScores.scoreDate, latestScoreDate[0].maxDate))
    : [];

  const latestPermits = await db
    .select({ geographyId: permitData.geographyId, totalPermits: permitData.totalPermits })
    .from(permitData)
    .where(sql`(${permitData.geographyId}, ${permitData.periodDate}) IN (SELECT geography_id, MAX(period_date) FROM permit_data GROUP BY geography_id)`);

  const latestUR = await db
    .select({ geographyId: employmentData.geographyId, unemploymentRate: employmentData.unemploymentRate })
    .from(employmentData)
    .where(sql`${employmentData.unemploymentRate} IS NOT NULL AND (${employmentData.geographyId}, ${employmentData.periodDate}) IN (SELECT geography_id, MAX(period_date) FROM employment_data WHERE unemployment_rate IS NOT NULL GROUP BY geography_id)`);

  const tradeCap = await db
    .select({
      geographyId: tradeCapacityData.geographyId,
      totalWorkers: sql<number>`SUM(avg_monthly_employment)`,
      avgWageYoy: sql<number>`ROUND(AVG(CAST(wage_yoy_change_pct AS numeric)), 1)`,
      totalEstabs: sql<number>`SUM(establishment_count)`,
    })
    .from(tradeCapacityData)
    .where(sql`${tradeCapacityData.periodDate} = (SELECT MAX(period_date) FROM trade_capacity_data)`)
    .groupBy(tradeCapacityData.geographyId);

  const scoreMap = new Map(scores.map((s) => [s.geographyId, s]));
  const permitMap = new Map(latestPermits.map((p) => [p.geographyId, p]));
  const urMap = new Map(latestUR.map((u) => [u.geographyId, u.unemploymentRate]));
  const tradeMap = new Map(tradeCap.map((t) => [t.geographyId, t]));

  const marketData = markets
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

  const narrative = await generatePortfolioNarrative(marketData);

  cache = { data: narrative, generatedAt: Date.now() };

  return NextResponse.json({ ...narrative, cached: false });
}
