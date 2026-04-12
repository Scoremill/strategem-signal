import { db } from "@/lib/db";
import { geographies, demandCapacityScores } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import FeasibilityClient from "./FeasibilityClient";

export const dynamic = "force-dynamic";

export default async function FeasibilityPage() {
  const markets = await db.select().from(geographies).where(eq(geographies.isActive, true)).orderBy(geographies.shortName);

  const latestScoreDate = await db.select({ maxDate: sql<string>`MAX(score_date)` }).from(demandCapacityScores);
  const scores = latestScoreDate[0]?.maxDate
    ? await db.select().from(demandCapacityScores).where(eq(demandCapacityScores.scoreDate, latestScoreDate[0].maxDate))
    : [];
  const scoreMap = new Map(scores.map((s) => [s.geographyId, s]));

  const marketList = markets
    .filter((m) => scoreMap.has(m.id))
    .map((m) => {
      const s = scoreMap.get(m.id)!;
      return {
        id: m.id,
        shortName: m.shortName,
        state: m.state,
        ratio: parseFloat(String(s.demandCapacityRatio)),
        status: s.status,
        estMonthlyStarts: s.estMonthlyStarts,
      };
    })
    .sort((a, b) => a.ratio - b.ratio);

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1E293B]">Community Feasibility</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Stress-test a proposed community against current demand-capacity dynamics before deploying capital.
        </p>
      </div>

      <FeasibilityClient markets={marketList} />
    </div>
  );
}
