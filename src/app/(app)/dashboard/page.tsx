import { db } from "@/lib/db";
import { geographies, permitData, employmentData, fetchLogs } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Fetch markets with their latest permit and employment data
  const markets = await db.select().from(geographies).orderBy(geographies.shortName);

  // Get latest permit data per MSA
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

  // Get latest employment data per MSA
  const latestEmployment = await db
    .select({
      geographyId: employmentData.geographyId,
      totalNonfarm: employmentData.totalNonfarm,
      unemploymentRate: employmentData.unemploymentRate,
      periodDate: employmentData.periodDate,
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
    .where(eq(fetchLogs.pipeline, "demand"))
    .orderBy(desc(fetchLogs.runAt))
    .limit(1);

  // Build lookup maps
  const permitMap = new Map(latestPermits.map((p) => [p.geographyId, p]));
  const employmentMap = new Map(latestEmployment.map((e) => [e.geographyId, e]));

  // Aggregate stats
  const totalPermits = latestPermits.reduce((sum, p) => sum + (p.totalPermits || 0), 0);
  const avgUnemployment =
    latestEmployment.reduce((sum, e) => sum + parseFloat(e.unemploymentRate || "0"), 0) /
    (latestEmployment.length || 1);

  const lastRunStr = lastRun
    ? new Date(lastRun.runAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Never";

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1E293B]">Portfolio Dashboard</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Demand-Capacity overview across {markets.length} monitored markets
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Markets</p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">{markets.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
            Monthly Permits
          </p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">
            {totalPermits.toLocaleString()}
          </p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">Latest month, all MSAs</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
            Avg Unemployment
          </p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">{avgUnemployment.toFixed(1)}%</p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">Across monitored markets</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
            Demand-Capacity Ratio
          </p>
          <p className="text-3xl font-bold text-[#6B7280] mt-1">—</p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">Phase 4 — Scoring Engine</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
            Last Data Fetch
          </p>
          <p className="text-sm font-medium text-[#1E293B] mt-2">{lastRunStr}</p>
        </div>
      </div>

      {/* Market list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1E293B]">Monitored Markets</h2>
          <span className="text-xs text-[#6B7280]">
            Data as of{" "}
            {latestPermits[0]
              ? new Date(latestPermits[0].periodDate).toLocaleDateString("en-US", {
                  month: "short",
                  year: "numeric",
                })
              : "—"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-5 font-medium text-[#6B7280]">Market</th>
                <th className="text-left py-3 px-5 font-medium text-[#6B7280]">State</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Permits/Mo</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Single Family</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Employment</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Unemp. Rate</th>
                <th className="text-center py-3 px-5 font-medium text-[#6B7280]">D/C Ratio</th>
                <th className="text-center py-3 px-5 font-medium text-[#6B7280]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {markets.map((m) => {
                const permit = permitMap.get(m.id);
                const emp = employmentMap.get(m.id);

                return (
                  <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-5 font-medium text-[#1E293B]">
                      <Link
                        href={`/geographies/${m.id}`}
                        className="hover:text-[#F97316] transition-colors"
                      >
                        {m.shortName}
                      </Link>
                    </td>
                    <td className="py-3 px-5 text-[#6B7280]">{m.state}</td>
                    <td className="py-3 px-5 text-right text-[#1E293B] font-medium">
                      {permit ? Math.round(permit.totalPermits).toLocaleString() : "—"}
                    </td>
                    <td className="py-3 px-5 text-right text-[#6B7280]">
                      {permit?.singleFamily
                        ? Math.round(permit.singleFamily).toLocaleString()
                        : "—"}
                    </td>
                    <td className="py-3 px-5 text-right text-[#1E293B]">
                      {emp?.totalNonfarm
                        ? (emp.totalNonfarm / 1000).toFixed(0) + "K"
                        : "—"}
                    </td>
                    <td className="py-3 px-5 text-right text-[#6B7280]">
                      {emp?.unemploymentRate ? `${emp.unemploymentRate}%` : "—"}
                    </td>
                    <td className="py-3 px-5 text-center text-[#6B7280]">—</td>
                    <td className="py-3 px-5 text-center">
                      <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
                        Awaiting Score
                      </span>
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
