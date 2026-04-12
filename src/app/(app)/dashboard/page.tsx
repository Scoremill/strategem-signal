import { db } from "@/lib/db";
import {
  geographies,
  permitData,
  employmentData,
  demandCapacityScores,
  fetchLogs,
} from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import DashboardTable, { DashboardRow } from "./DashboardTable";
import PortfolioIntelligence from "@/components/PortfolioIntelligence";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const markets = await db.select().from(geographies).orderBy(geographies.shortName);

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

  // Get most recent unemployment rate per MSA (may differ from latest employment date)
  const latestUR = await db
    .select({
      geographyId: employmentData.geographyId,
      unemploymentRate: employmentData.unemploymentRate,
    })
    .from(employmentData)
    .where(
      sql`${employmentData.unemploymentRate} IS NOT NULL AND (${employmentData.geographyId}, ${employmentData.periodDate}) IN (
        SELECT geography_id, MAX(period_date) FROM employment_data WHERE unemployment_rate IS NOT NULL GROUP BY geography_id
      )`
    );
  const urMap = new Map(latestUR.map((u) => [u.geographyId, u.unemploymentRate]));

  // Get last pipeline run
  const [lastRun] = await db.select().from(fetchLogs).orderBy(desc(fetchLogs.runAt)).limit(1);

  // Build lookup maps
  const scoreMap = new Map(scores.map((s) => [s.geographyId, s]));
  const permitMap = new Map(latestPermits.map((p) => [p.geographyId, p]));
  const empMap = new Map(latestEmployment.map((e) => [e.geographyId, e]));

  // Status counts
  const constrained = scores.filter((s) => s.status === "constrained").length;
  const equilibrium = scores.filter((s) => s.status === "equilibrium").length;
  const favorable = scores.filter((s) => s.status === "favorable").length;

  // Build table rows
  const rows: DashboardRow[] = markets.map((m) => {
    const score = scoreMap.get(m.id);
    const permit = permitMap.get(m.id);
    const emp = empMap.get(m.id);
    const statusOrder = score?.status === "constrained" ? 3 : score?.status === "equilibrium" ? 2 : score?.status === "favorable" ? 1 : 0;

    return {
      id: m.id,
      shortName: m.shortName,
      state: m.state,
      demandIndex: score ? parseFloat(String(score.demandIndex)) : null,
      capacityIndex: score ? parseFloat(String(score.capacityIndex)) : null,
      ratio: score ? parseFloat(String(score.demandCapacityRatio)) : null,
      status: score?.status ?? null,
      statusSort: statusOrder,
      permits: permit?.totalPermits ?? null,
      singleFamily: permit?.singleFamily ?? null,
      estStarts: score?.estMonthlyStarts ?? null,
      employment: emp?.totalNonfarm ?? null,
      unemploymentRate: urMap.get(m.id) ? parseFloat(String(urMap.get(m.id))) : (emp?.unemploymentRate ? parseFloat(String(emp.unemploymentRate)) : null),
    };
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1E293B]">Market Dashboard</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Demand-Capacity overview across {markets.length} monitored markets
          {maxScoreDate && ` — Scored ${new Date(maxScoreDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
        </p>
      </div>

      {/* Portfolio Intelligence */}
      <PortfolioIntelligence />

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
        <div className="bg-white rounded-xl border-l-4 border-amber-500 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Balanced</p>
          <p className="text-3xl font-bold text-amber-800 mt-1">{equilibrium}</p>
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
              ? new Date(lastRun.runAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
              : "Never"}
          </p>
        </div>
      </div>

      {/* Market table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1E293B]">Markets by Demand-Capacity Ratio</h2>
          <span className="text-xs text-[#6B7280]">Click column headers to sort</span>
        </div>
        <DashboardTable rows={rows} />
      </div>
    </div>
  );
}
