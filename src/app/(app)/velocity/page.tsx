import { db } from "@/lib/db";
import { geographies, demandCapacityScores } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function VelocityPage() {
  const latestScoreDate = await db
    .select({ maxDate: sql<string>`MAX(score_date)` })
    .from(demandCapacityScores);
  const maxScoreDate = latestScoreDate[0]?.maxDate;

  const scores = maxScoreDate
    ? await db.select().from(demandCapacityScores).where(eq(demandCapacityScores.scoreDate, maxScoreDate))
    : [];

  const markets = await db.select().from(geographies).orderBy(geographies.shortName);
  const scoreMap = new Map(scores.map((s) => [s.geographyId, s]));

  // Sort by ratio — most constrained first (these are "accelerating demand")
  const sorted = [...markets]
    .map((m) => ({ ...m, score: scoreMap.get(m.id) }))
    .filter((m) => m.score)
    .sort((a, b) => {
      const ra = parseFloat(String(a.score!.demandCapacityRatio));
      const rb = parseFloat(String(b.score!.demandCapacityRatio));
      return rb - ra;
    });

  const deteriorating = sorted.filter((m) => parseFloat(String(m.score!.demandCapacityRatio)) > 1.0);
  const improving = sorted.filter((m) => parseFloat(String(m.score!.demandCapacityRatio)) <= 1.0).reverse();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#1E293B]">Velocity</h1>
      <p className="text-sm text-[#6B7280] mt-1">
        Markets where demand is outpacing capacity vs. markets with available capacity
      </p>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Deteriorating */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-red-200 bg-red-50">
            <h2 className="text-sm font-semibold text-red-800">
              Demand Outpacing Capacity ({deteriorating.length})
            </h2>
            <p className="text-xs text-red-600 mt-0.5">Ratio &gt; 1.0 — expect trade cost pressure</p>
          </div>
          <div className="divide-y divide-gray-100">
            {deteriorating.map((m) => {
              const ratio = parseFloat(String(m.score!.demandCapacityRatio));
              return (
                <div key={m.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-[#1E293B]">{m.shortName}</span>
                    <span className="text-xs text-[#6B7280] ml-2">{m.state}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-[#6B7280]">
                      D:{parseFloat(String(m.score!.demandIndex)).toFixed(0)} C:{parseFloat(String(m.score!.capacityIndex)).toFixed(0)}
                    </span>
                    <span className="text-sm font-bold text-red-700">{ratio.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
            {deteriorating.length === 0 && (
              <div className="px-5 py-8 text-center text-[#6B7280]">No markets in this category</div>
            )}
          </div>
        </div>

        {/* Improving */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-green-200 bg-green-50">
            <h2 className="text-sm font-semibold text-green-800">
              Capacity Available ({improving.length})
            </h2>
            <p className="text-xs text-green-600 mt-0.5">Ratio &le; 1.0 — favorable for expansion</p>
          </div>
          <div className="divide-y divide-gray-100">
            {improving.map((m) => {
              const ratio = parseFloat(String(m.score!.demandCapacityRatio));
              return (
                <div key={m.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-[#1E293B]">{m.shortName}</span>
                    <span className="text-xs text-[#6B7280] ml-2">{m.state}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-[#6B7280]">
                      D:{parseFloat(String(m.score!.demandIndex)).toFixed(0)} C:{parseFloat(String(m.score!.capacityIndex)).toFixed(0)}
                    </span>
                    <span className="text-sm font-bold text-green-700">{ratio.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
            {improving.length === 0 && (
              <div className="px-5 py-8 text-center text-[#6B7280]">No markets in this category</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
