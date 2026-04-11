import { db } from "@/lib/db";
import { geographies, demandCapacityScores } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  constrained: { bg: "bg-red-100", text: "text-red-800", label: "Constrained" },
  equilibrium: { bg: "bg-yellow-100", text: "text-yellow-800", label: "Equilibrium" },
  favorable: { bg: "bg-green-100", text: "text-green-800", label: "Favorable" },
};

export default async function GeographiesPage() {
  const markets = await db.select().from(geographies).orderBy(geographies.name);

  const latestScoreDate = await db
    .select({ maxDate: sql<string>`MAX(score_date)` })
    .from(demandCapacityScores);
  const maxScoreDate = latestScoreDate[0]?.maxDate;

  const scores = maxScoreDate
    ? await db.select().from(demandCapacityScores).where(eq(demandCapacityScores.scoreDate, maxScoreDate))
    : [];
  const scoreMap = new Map(scores.map((s) => [s.geographyId, s]));

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#1E293B]">Markets</h1>
      <p className="text-sm text-[#6B7280] mt-1">All {markets.length} monitored MSA markets</p>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {markets.map((m) => {
          const score = scoreMap.get(m.id);
          const ratio = score ? parseFloat(String(score.demandCapacityRatio)) : null;
          const style = score ? STATUS_STYLES[score.status] : null;

          return (
            <Link
              key={m.id}
              href={`/geographies/${m.id}`}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:border-[#F97316]/50 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-[#1E293B]">{m.shortName}</h3>
                  <p className="text-xs text-[#6B7280] mt-0.5">{m.name}</p>
                </div>
                {style && (
                  <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
                    {style.label}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-[#6B7280]">
                <span>CBSA: {m.cbsaFips}</span>
                <span>{m.state}</span>
                {m.population && <span>Pop: {(m.population / 1_000_000).toFixed(1)}M</span>}
              </div>
              {score && (
                <div className="flex items-center gap-4 mt-2 text-xs">
                  <span className="text-[#6B7280]">D: <strong className="text-[#1E293B]">{parseFloat(String(score.demandIndex)).toFixed(0)}</strong></span>
                  <span className="text-[#6B7280]">C: <strong className="text-[#1E293B]">{parseFloat(String(score.capacityIndex)).toFixed(0)}</strong></span>
                  <span className={`font-bold ${
                    ratio! > 1.15 ? "text-red-700" : ratio! < 0.85 ? "text-green-700" : "text-yellow-700"
                  }`}>
                    Ratio: {ratio!.toFixed(2)}
                  </span>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
