import { db } from "@/lib/db";
import { geographies, tradeCapacityData } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function CapacityPage() {
  // Get latest quarter's data grouped by MSA
  const latestQuarter = await db
    .select({ maxDate: sql<string>`MAX(period_date)` })
    .from(tradeCapacityData);

  const maxDate = latestQuarter[0]?.maxDate;

  // Get aggregated trade data per MSA for latest quarter
  const capacityData = maxDate
    ? await db
        .select({
          geographyId: tradeCapacityData.geographyId,
          totalEmployment: sql<number>`SUM(avg_monthly_employment)`,
          totalEstablishments: sql<number>`SUM(establishment_count)`,
          avgWeeklyWage: sql<number>`ROUND(AVG(CAST(avg_weekly_wage AS numeric)))`,
          avgWageYoy: sql<number>`ROUND(AVG(CAST(wage_yoy_change_pct AS numeric)), 1)`,
          avgEmpYoy: sql<number>`ROUND(AVG(CAST(employment_yoy_change_pct AS numeric)), 1)`,
        })
        .from(tradeCapacityData)
        .where(eq(tradeCapacityData.periodDate, maxDate))
        .groupBy(tradeCapacityData.geographyId)
    : [];

  const markets = await db.select().from(geographies).orderBy(geographies.shortName);
  const capMap = new Map(capacityData.map((c) => [c.geographyId, c]));

  // Aggregate stats
  const totalWorkers = capacityData.reduce((s, c) => s + Number(c.totalEmployment), 0);
  const totalEstabs = capacityData.reduce((s, c) => s + Number(c.totalEstablishments), 0);
  const avgWage = capacityData.length
    ? Math.round(capacityData.reduce((s, c) => s + Number(c.avgWeeklyWage), 0) / capacityData.length)
    : 0;
  const avgWageGrowth = capacityData.length
    ? (capacityData.reduce((s, c) => s + Number(c.avgWageYoy || 0), 0) / capacityData.length).toFixed(1)
    : "—";

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1E293B]">Trade Capacity Dashboard</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Trade labor employment, wages, and establishment counts across monitored markets
          {maxDate && (
            <span>
              {" "}— Data as of{" "}
              {new Date(maxDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
            </span>
          )}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
            Total Trade Workers
          </p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">
            {totalWorkers.toLocaleString()}
          </p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">NAICS 2381-2389, all MSAs</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
            Trade Establishments
          </p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">
            {totalEstabs.toLocaleString()}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
            Avg Weekly Wage
          </p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">${avgWage.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
            Avg Wage Growth YoY
          </p>
          <p
            className={`text-3xl font-bold mt-1 ${
              Number(avgWageGrowth) > 5
                ? "text-red-600"
                : Number(avgWageGrowth) > 3
                  ? "text-yellow-600"
                  : "text-green-600"
            }`}
          >
            {avgWageGrowth}%
          </p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">
            {Number(avgWageGrowth) > 5 ? "Capacity pressure" : "Stable"}
          </p>
        </div>
      </div>

      {/* Market capacity table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-[#1E293B]">
            Trade Capacity by Market
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-5 font-medium text-[#6B7280]">Market</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Trade Workers</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Establishments</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Avg Weekly Wage</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Wage Growth YoY</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Emp Growth YoY</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {markets.map((m) => {
                const cap = capMap.get(m.id);
                const wageYoy = Number(cap?.avgWageYoy || 0);
                const empYoy = Number(cap?.avgEmpYoy || 0);

                return (
                  <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-5 font-medium text-[#1E293B]">{m.shortName}</td>
                    <td className="py-3 px-5 text-right text-[#1E293B] font-medium">
                      {cap ? Number(cap.totalEmployment).toLocaleString() : "—"}
                    </td>
                    <td className="py-3 px-5 text-right text-[#6B7280]">
                      {cap ? Number(cap.totalEstablishments).toLocaleString() : "—"}
                    </td>
                    <td className="py-3 px-5 text-right text-[#1E293B]">
                      {cap ? `$${Number(cap.avgWeeklyWage).toLocaleString()}` : "—"}
                    </td>
                    <td className="py-3 px-5 text-right">
                      <span
                        className={`font-medium ${
                          wageYoy > 5
                            ? "text-red-600"
                            : wageYoy > 3
                              ? "text-yellow-600"
                              : "text-green-600"
                        }`}
                      >
                        {cap ? `${wageYoy > 0 ? "+" : ""}${wageYoy}%` : "—"}
                      </span>
                    </td>
                    <td className="py-3 px-5 text-right">
                      <span
                        className={`font-medium ${
                          empYoy > 0 ? "text-green-600" : empYoy < -2 ? "text-red-600" : "text-[#6B7280]"
                        }`}
                      >
                        {cap ? `${empYoy > 0 ? "+" : ""}${empYoy}%` : "—"}
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
