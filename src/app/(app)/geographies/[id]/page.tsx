import { db } from "@/lib/db";
import {
  geographies,
  permitData,
  employmentData,
  tradeCapacityData,
  demandCapacityScores,
} from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import MarketNarrative from "@/components/MarketNarrative";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  constrained: { bg: "bg-red-100", text: "text-red-800", label: "Constrained" },
  equilibrium: { bg: "bg-amber-100", text: "text-amber-800", label: "Balanced" },
  favorable: { bg: "bg-green-100", text: "text-green-800", label: "Favorable" },
};

export default async function GeographyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [market] = await db
    .select()
    .from(geographies)
    .where(eq(geographies.id, id))
    .limit(1);

  if (!market) notFound();

  // Get latest score
  const [latestScore] = await db
    .select()
    .from(demandCapacityScores)
    .where(eq(demandCapacityScores.geographyId, id))
    .orderBy(desc(demandCapacityScores.scoreDate))
    .limit(1);

  // Get permit history (last 24 months)
  const permits = await db
    .select()
    .from(permitData)
    .where(eq(permitData.geographyId, id))
    .orderBy(desc(permitData.periodDate))
    .limit(24);

  // Get employment history
  const employment = await db
    .select()
    .from(employmentData)
    .where(eq(employmentData.geographyId, id))
    .orderBy(desc(employmentData.periodDate))
    .limit(24);

  // Get trade capacity (latest quarter, by NAICS)
  const trades = await db
    .select()
    .from(tradeCapacityData)
    .where(
      sql`${tradeCapacityData.geographyId} = ${id} AND ${tradeCapacityData.periodDate} = (
        SELECT MAX(period_date) FROM trade_capacity_data WHERE geography_id = ${id}
      )`
    )
    .orderBy(desc(tradeCapacityData.avgMonthlyEmployment));

  // Get trade capacity history (aggregate by quarter)
  const tradeHistory = await db
    .select({
      periodDate: tradeCapacityData.periodDate,
      totalWorkers: sql<number>`SUM(avg_monthly_employment)`,
      avgWage: sql<number>`ROUND(AVG(CAST(avg_weekly_wage AS numeric)))`,
      totalEstabs: sql<number>`SUM(establishment_count)`,
    })
    .from(tradeCapacityData)
    .where(eq(tradeCapacityData.geographyId, id))
    .groupBy(tradeCapacityData.periodDate)
    .orderBy(desc(tradeCapacityData.periodDate));

  const ratio = latestScore ? parseFloat(String(latestScore.demandCapacityRatio)) : null;
  const style = latestScore ? STATUS_STYLES[latestScore.status] : null;
  const totalTradeWorkers = trades.reduce((s, t) => s + t.avgMonthlyEmployment, 0);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <Link href="/geographies" className="text-sm text-[#6B7280] hover:text-[#F97316] transition-colors">
          &larr; All Markets
        </Link>
        <div className="flex items-center gap-4 mt-2">
          <h1 className="text-2xl font-bold text-[#1E293B]">{market.name}</h1>
          {style && (
            <span className={`inline-flex items-center text-xs font-medium px-3 py-1 rounded-full ${style.bg} ${style.text}`}>
              {style.label}
            </span>
          )}
        </div>
        <p className="text-sm text-[#6B7280] mt-1">CBSA: {market.cbsaFips} | Population: {market.population?.toLocaleString() ?? "—"}</p>
      </div>

      {/* Score summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Demand Index</p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">
            {latestScore ? parseFloat(String(latestScore.demandIndex)).toFixed(0) : "—"}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Capacity Index</p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">
            {latestScore ? parseFloat(String(latestScore.capacityIndex)).toFixed(0) : "—"}
          </p>
        </div>
        <div className={`bg-white rounded-xl border-l-4 p-5 ${
          ratio !== null && ratio > 1.15 ? "border-red-500" : ratio !== null && ratio < 0.85 ? "border-green-500" : "border-yellow-500"
        }`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">D/C Ratio</p>
          <p className={`text-3xl font-bold mt-1 ${
            ratio !== null && ratio > 1.15 ? "text-red-700" : ratio !== null && ratio < 0.85 ? "text-green-700" : "text-yellow-700"
          }`}>
            {ratio?.toFixed(2) ?? "—"}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Trade Workers</p>
          <p className="text-3xl font-bold text-[#1E293B] mt-1">{totalTradeWorkers.toLocaleString()}</p>
        </div>
      </div>

      {/* AI Market Narrative */}
      <MarketNarrative geographyId={id} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Permit History */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-[#1E293B]">Building Permits (Monthly)</h2>
          </div>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-5 font-medium text-[#6B7280]">Month</th>
                  <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Total</th>
                  <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Single Family</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {permits.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="py-2 px-5 text-[#1E293B]">
                      {new Date(p.periodDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                    </td>
                    <td className="py-2 px-5 text-right font-medium text-[#1E293B]">{Math.round(p.totalPermits).toLocaleString()}</td>
                    <td className="py-2 px-5 text-right text-[#6B7280]">{p.singleFamily ? Math.round(p.singleFamily).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Employment History */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-[#1E293B]">Employment (Monthly)</h2>
          </div>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-5 font-medium text-[#6B7280]">Month</th>
                  <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Nonfarm</th>
                  <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Unemp Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {employment.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="py-2 px-5 text-[#1E293B]">
                      {new Date(e.periodDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                    </td>
                    <td className="py-2 px-5 text-right font-medium text-[#1E293B]">{e.totalNonfarm ? (e.totalNonfarm / 1000).toFixed(0) + "K" : "—"}</td>
                    <td className="py-2 px-5 text-right text-[#6B7280]">{e.unemploymentRate ? `${e.unemploymentRate}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trade Capacity by NAICS */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-[#1E293B]">Trade Capacity by Sector (Latest Quarter)</h2>
            {trades.length < 4 && (
              <p className="text-[10px] text-[#6B7280] mt-1">
                Some NAICS sectors may be suppressed by BLS to protect employer confidentiality in markets with few firms.
              </p>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-2 px-5 font-medium text-[#6B7280]">NAICS</th>
                <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Workers</th>
                <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Wage/Wk</th>
                <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Wage YoY</th>
                <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Estabs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {trades.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="py-2 px-5 text-[#1E293B]">
                    <span className="font-medium">{t.naicsCode}</span>
                    <span className="text-xs text-[#6B7280] ml-2">{t.naicsDescription}</span>
                  </td>
                  <td className="py-2 px-5 text-right font-medium text-[#1E293B]">{t.avgMonthlyEmployment.toLocaleString()}</td>
                  <td className="py-2 px-5 text-right text-[#1E293B]">${Number(t.avgWeeklyWage).toLocaleString()}</td>
                  <td className="py-2 px-5 text-right">
                    <span className={`font-medium ${
                      Number(t.wageYoyChangePct) > 5 ? "text-red-600" : Number(t.wageYoyChangePct) > 3 ? "text-yellow-600" : "text-green-600"
                    }`}>
                      {t.wageYoyChangePct ? `${Number(t.wageYoyChangePct) > 0 ? "+" : ""}${t.wageYoyChangePct}%` : "—"}
                    </span>
                  </td>
                  <td className="py-2 px-5 text-right text-[#6B7280]">{t.establishmentCount?.toLocaleString() ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Trade Capacity History */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-[#1E293B]">Trade Capacity Trend (Quarterly)</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-2 px-5 font-medium text-[#6B7280]">Quarter</th>
                <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Workers</th>
                <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Avg Wage/Wk</th>
                <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Establishments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tradeHistory.map((h) => (
                <tr key={String(h.periodDate)} className="hover:bg-gray-50">
                  <td className="py-2 px-5 text-[#1E293B]">
                    {new Date(String(h.periodDate)).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                  </td>
                  <td className="py-2 px-5 text-right font-medium text-[#1E293B]">{Number(h.totalWorkers).toLocaleString()}</td>
                  <td className="py-2 px-5 text-right text-[#1E293B]">${Number(h.avgWage).toLocaleString()}</td>
                  <td className="py-2 px-5 text-right text-[#6B7280]">{Number(h.totalEstabs).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
