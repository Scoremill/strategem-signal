import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { geographies, tradeCapacityData, demandCapacityScores, permitData } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { generateBuilderImplications } from "@/lib/capacity-narrative";

let cache: { data: unknown; generatedAt: number } | null = null;
const CACHE_TTL = 6 * 60 * 60 * 1000;

export async function GET() {
  if (cache && Date.now() - cache.generatedAt < CACHE_TTL) {
    return NextResponse.json({ implications: cache.data, cached: true });
  }

  const markets = await db.select().from(geographies).where(eq(geographies.isActive, true));

  const latestScoreDate = await db.select({ maxDate: sql<string>`MAX(score_date)` }).from(demandCapacityScores);
  const scores = latestScoreDate[0]?.maxDate
    ? await db.select().from(demandCapacityScores).where(eq(demandCapacityScores.scoreDate, latestScoreDate[0].maxDate))
    : [];

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

  const latestPermits = await db
    .select({ geographyId: permitData.geographyId, totalPermits: permitData.totalPermits })
    .from(permitData)
    .where(sql`(${permitData.geographyId}, ${permitData.periodDate}) IN (SELECT geography_id, MAX(period_date) FROM permit_data GROUP BY geography_id)`);

  const scoreMap = new Map(scores.map((s) => [s.geographyId, s]));
  const tradeMap = new Map(tradeCap.map((t) => [t.geographyId, t]));
  const permitMap = new Map(latestPermits.map((p) => [p.geographyId, p]));

  const marketData = markets
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

  const implications = await generateBuilderImplications(marketData);
  cache = { data: implications, generatedAt: Date.now() };

  return NextResponse.json({ implications, cached: false });
}
