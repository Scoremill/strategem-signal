import { db } from "@/lib/db";
import { geographies, demandCapacityScores, permitData, tradeCapacityData } from "@/lib/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import HeatmapClient from "./HeatmapClient";

export const dynamic = "force-dynamic";

export default async function HeatmapPage() {
  const markets = await db.select().from(geographies).where(eq(geographies.isActive, true));

  // Get latest scores
  const latestScoreDate = await db
    .select({ maxDate: sql<string>`MAX(score_date)` })
    .from(demandCapacityScores);
  const maxScoreDate = latestScoreDate[0]?.maxDate;

  const scores = maxScoreDate
    ? await db.select().from(demandCapacityScores).where(eq(demandCapacityScores.scoreDate, maxScoreDate))
    : [];

  // Get latest permits per MSA
  const latestPermits = await db
    .select({
      geographyId: permitData.geographyId,
      totalPermits: permitData.totalPermits,
    })
    .from(permitData)
    .where(
      sql`(${permitData.geographyId}, ${permitData.periodDate}) IN (
        SELECT geography_id, MAX(period_date) FROM permit_data GROUP BY geography_id
      )`
    );

  // Get latest trade workers per MSA
  const latestTrade = await db
    .select({
      geographyId: tradeCapacityData.geographyId,
      totalWorkers: sql<number>`SUM(avg_monthly_employment)`,
    })
    .from(tradeCapacityData)
    .where(
      sql`${tradeCapacityData.periodDate} = (SELECT MAX(period_date) FROM trade_capacity_data)`
    )
    .groupBy(tradeCapacityData.geographyId);

  const scoreMap = new Map(scores.map((s) => [s.geographyId, s]));
  const permitMap = new Map(latestPermits.map((p) => [p.geographyId, p]));
  const tradeMap = new Map(latestTrade.map((t) => [t.geographyId, t]));

  const marketPoints = markets.map((m) => {
    const score = scoreMap.get(m.id);
    const permit = permitMap.get(m.id);
    const trade = tradeMap.get(m.id);

    return {
      id: m.id,
      shortName: m.shortName,
      state: m.state,
      lat: m.lat,
      lng: m.lng,
      demandIndex: score ? parseFloat(String(score.demandIndex)) : null,
      capacityIndex: score ? parseFloat(String(score.capacityIndex)) : null,
      ratio: score ? parseFloat(String(score.demandCapacityRatio)) : null,
      status: score?.status ?? null,
      permits: permit?.totalPermits ?? null,
      tradeWorkers: trade ? Number(trade.totalWorkers) : null,
    };
  });

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-8 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-base sm:text-lg font-bold text-[#1E293B]">Demand-Capacity Heatmap</h1>
        <p className="text-xs text-[#6B7280] mt-0.5">
          Click a market for details. Toggle between Ratio, Demand, and Capacity views.
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <HeatmapClient markets={marketPoints} />
      </div>
    </div>
  );
}
