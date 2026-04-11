import { db } from "@/lib/db";
import { geographies, tradeCapacityData } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import CapacityTable, { CapacityRow } from "./CapacityTable";

export const dynamic = "force-dynamic";

export default async function CapacityPage() {
  const latestQuarter = await db
    .select({ maxDate: sql<string>`MAX(period_date)` })
    .from(tradeCapacityData);
  const maxDate = latestQuarter[0]?.maxDate;

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

  const totalWorkers = capacityData.reduce((s, c) => s + Number(c.totalEmployment), 0);
  const totalEstabs = capacityData.reduce((s, c) => s + Number(c.totalEstablishments), 0);
  const avgWage = capacityData.length
    ? Math.round(capacityData.reduce((s, c) => s + Number(c.avgWeeklyWage), 0) / capacityData.length)
    : 0;
  const avgWageGrowth = capacityData.length
    ? (capacityData.reduce((s, c) => s + Number(c.avgWageYoy || 0), 0) / capacityData.length).toFixed(1)
    : "—";

  const rows: CapacityRow[] = markets.map((m) => {
    const cap = capMap.get(m.id);
    return {
      id: m.id,
      shortName: m.shortName,
      totalEmployment: cap ? Number(cap.totalEmployment) : null,
      totalEstablishments: cap ? Number(cap.totalEstablishments) : null,
      avgWeeklyWage: cap ? Number(cap.avgWeeklyWage) : null,
      avgWageYoy: cap ? Number(cap.avgWageYoy) : null,
      avgEmpYoy: cap ? Number(cap.avgEmpYoy) : null,
    };
  });

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
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Total Trade Workers</p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">{totalWorkers.toLocaleString()}</p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">NAICS 2381-2389, all MSAs</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Trade Establishments</p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">{totalEstabs.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Avg Weekly Wage</p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">${avgWage.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Avg Wage Growth YoY</p>
          <p className={`text-3xl font-bold mt-1 ${
            Number(avgWageGrowth) > 5 ? "text-red-600" : Number(avgWageGrowth) > 3 ? "text-yellow-600" : "text-green-600"
          }`}>
            {avgWageGrowth}%
          </p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">
            {Number(avgWageGrowth) > 5 ? "Capacity pressure" : "Stable"}
          </p>
        </div>
      </div>

      {/* Capacity table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1E293B]">Trade Capacity by Market</h2>
          <span className="text-xs text-[#6B7280]">Click column headers to sort</span>
        </div>
        <CapacityTable rows={rows} />
      </div>
    </div>
  );
}
