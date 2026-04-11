import { db } from "@/lib/db";
import {
  geographies,
  permitData,
  employmentData,
  demandCapacityScores,
  fetchLogs,
} from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STATUS_STYLES = {
  constrained: { bg: "bg-red-100", text: "text-red-800", label: "Constrained" },
  equilibrium: { bg: "bg-yellow-100", text: "text-yellow-800", label: "Equilibrium" },
  favorable: { bg: "bg-green-100", text: "text-green-800", label: "Favorable" },
};

export default async function DashboardPage() {
  const markets = await db.select().from(geographies).orderBy(geographies.shortName);

  // Get latest scores
  const latestScoreDate = await db
    .select({ maxDate: sql<string>`MAX(score_date)` })
    .from(demandCapacityScores);
  const maxScoreDate = latestScoreDate[0]?.maxDate;

  const scores = maxScoreDate
    ? await db
        .select()
        .from(demandCapacityScores)
        .where(eq(demandCapacityScores.scoreDate, maxScoreDate))
    : [];

  // Get latest permits per MSA
  const latestPermits = await db
    .select({
      geographyId: permitData.geographyId,
      totalPermits: permitData.totalPermits,
      singleFamily: permitData.singleFamily,
      periodDate: permitData.periodDate,
    })
    .from(permitData)
    .where(
      sql`(${permitData.geographyId}, ${permitData.periodDate}) IN (
        SELECT geography_id, MAX(period_date) FROM permit_data GROUP BY geography_id
      )`
    );

  // Get latest employment per MSA
  const latestEmployment = await db
    .select({
      geographyId: employmentData.geographyId,
      totalNonfarm: employmentData.totalNonfarm,
      unemploymentRate: employmentData.unemploymentRate,
    })
    .from(employmentData)
    .where(
      sql`(${employmentData.geographyId}, ${employmentData.periodDate}) IN (
        SELECT geography_id, MAX(period_date) FROM employment_data GROUP BY geography_id
      )`
    );

  // Get last pipeline run
  const [lastRun] = await db
    .select()
    .from(fetchLogs)
    .orderBy(desc(fetchLogs.runAt))
    .limit(1);

  // Build lookup maps
  const scoreMap = new Map(scores.map((s) => [s.geographyId, s]));
  const permitMap = new Map(latestPermits.map((p) => [p.geographyId, p]));
  const empMap = new Map(latestEmployment.map((e) => [e.geographyId, e]));

  // Status counts
  const constrained = scores.filter((s) => s.status === "constrained").length;
  const equilibrium = scores.filter((s) => s.status === "equilibrium").length;
  const favorable = scores.filter((s) => s.status === "favorable").length;

  // Sort markets by ratio (most constrained first)
  const sortedMarkets = [...markets].sort((a, b) => {
    const sa = scoreMap.get(a.id);
    const sb = scoreMap.get(b.id);
    if (!sa && !sb) return 0;
    if (!sa) return 1;
    if (!sb) return -1;
    return parseFloat(String(sb.demandCapacityRatio)) - parseFloat(String(sa.demandCapacityRatio));
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1E293B]">Portfolio Dashboard</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Demand-Capacity overview across {markets.length} monitored markets
          {maxScoreDate && ` — Scored ${new Date(maxScoreDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Markets</p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">{markets.length}</p>
        </div>
        <div className="bg-white rounded-xl border-l-4 border-red-500 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-600">Constrained</p>
          <p className="text-3xl font-bold text-red-700 mt-1">{constrained}</p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">Ratio &gt; 1.15</p>
        </div>
        <div className="bg-white rounded-xl border-l-4 border-yellow-500 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-yellow-600">Equilibrium</p>
          <p className="text-3xl font-bold text-yellow-700 mt-1">{equilibrium}</p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">Ratio 0.85–1.15</p>
        </div>
        <div className="bg-white rounded-xl border-l-4 border-green-500 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-green-600">Favorable</p>
          <p className="text-3xl font-bold text-green-700 mt-1">{favorable}</p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">Ratio &lt; 0.85</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Last Update</p>
          <p className="text-sm font-medium text-[#1E293B] mt-2">
            {lastRun
              ? new Date(lastRun.runAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "Never"}
          </p>
        </div>
      </div>

      {/* Market list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1E293B]">Markets by Demand-Capacity Ratio</h2>
          <span className="text-xs text-[#6B7280]">Sorted: most constrained first</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-5 font-medium text-[#6B7280]">Market</th>
                <th className="text-center py-3 px-5 font-medium text-[#6B7280]">Demand</th>
                <th className="text-center py-3 px-5 font-medium text-[#6B7280]">Capacity</th>
                <th className="text-center py-3 px-5 font-medium text-[#6B7280]">D/C Ratio</th>
                <th className="text-center py-3 px-5 font-medium text-[#6B7280]">Status</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Permits/Mo</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Employment</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Unemp Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedMarkets.map((m) => {
                const score = scoreMap.get(m.id);
                const permit = permitMap.get(m.id);
                const emp = empMap.get(m.id);
                const style = score
                  ? STATUS_STYLES[score.status as keyof typeof STATUS_STYLES]
                  : null;
                const ratio = score ? parseFloat(String(score.demandCapacityRatio)) : null;

                return (
                  <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-5 font-medium text-[#1E293B]">
                      <Link
                        href={`/geographies/${m.id}`}
                        className="hover:text-[#F97316] transition-colors"
                      >
                        {m.shortName}
                      </Link>
                      <span className="text-xs text-[#6B7280] ml-2">{m.state}</span>
                    </td>
                    <td className="py-3 px-5 text-center">
                      {score ? (
                        <span className="text-sm font-semibold text-[#1E293B]">
                          {parseFloat(String(score.demandIndex)).toFixed(0)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-3 px-5 text-center">
                      {score ? (
                        <span className="text-sm font-semibold text-[#1E293B]">
                          {parseFloat(String(score.capacityIndex)).toFixed(0)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-3 px-5 text-center">
                      {ratio !== null ? (
                        <span
                          className={`text-sm font-bold ${
                            ratio > 1.15
                              ? "text-red-700"
                              : ratio < 0.85
                                ? "text-green-700"
                                : "text-yellow-700"
                          }`}
                        >
                          {ratio.toFixed(2)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-3 px-5 text-center">
                      {style ? (
                        <span
                          className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full ${style.bg} ${style.text}`}
                        >
                          {style.label}
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
                          Unscored
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-5 text-right text-[#1E293B]">
                      {permit ? Math.round(permit.totalPermits).toLocaleString() : "—"}
                    </td>
                    <td className="py-3 px-5 text-right text-[#1E293B]">
                      {emp?.totalNonfarm ? (emp.totalNonfarm / 1000).toFixed(0) + "K" : "—"}
                    </td>
                    <td className="py-3 px-5 text-right text-[#6B7280]">
                      {emp?.unemploymentRate ? `${emp.unemploymentRate}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
