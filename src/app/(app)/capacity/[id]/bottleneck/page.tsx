import { db } from "@/lib/db";
import { geographies, occupationData } from "@/lib/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

const TIGHTNESS_THRESHOLDS = {
  red: 5,    // wage growth >5% YoY = tight
  yellow: 3, // 3-5% = warming
};

function tightnessClass(yoy: number | null): { bg: string; text: string; label: string } {
  if (yoy == null) return { bg: "bg-gray-100", text: "text-gray-700", label: "—" };
  if (yoy >= TIGHTNESS_THRESHOLDS.red)    return { bg: "bg-red-100",    text: "text-red-700",    label: "Tight" };
  if (yoy >= TIGHTNESS_THRESHOLDS.yellow) return { bg: "bg-amber-100",  text: "text-amber-700",  label: "Warming" };
  return { bg: "bg-green-100", text: "text-green-700", label: "Ample" };
}

function dollars(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${Math.round(v).toLocaleString()}`;
}

export default async function TradeBottleneckPage({
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

  // Latest vintage for this market
  const [latestVintageRow] = await db
    .select({ vintageYear: sql<number>`MAX(${occupationData.vintageYear})` })
    .from(occupationData)
    .where(eq(occupationData.geographyId, id));

  const latestVintage = latestVintageRow?.vintageYear ?? null;

  const occupations = latestVintage
    ? await db
        .select()
        .from(occupationData)
        .where(and(eq(occupationData.geographyId, id), eq(occupationData.vintageYear, latestVintage)))
        .orderBy(desc(occupationData.employment))
    : [];

  // Sort by tightness (wage YoY desc) for the "tightest first" view
  const byTightness = [...occupations].sort((a, b) => {
    const av = a.wageYoyChangePct != null ? Number(a.wageYoyChangePct) : -Infinity;
    const bv = b.wageYoyChangePct != null ? Number(b.wageYoyChangePct) : -Infinity;
    return bv - av;
  });

  const totalEmp = occupations.reduce((s, o) => s + (o.employment ?? 0), 0);
  const tightCount = occupations.filter(
    (o) => o.wageYoyChangePct != null && Number(o.wageYoyChangePct) >= TIGHTNESS_THRESHOLDS.red
  ).length;
  const warmingCount = occupations.filter(
    (o) => {
      const v = o.wageYoyChangePct != null ? Number(o.wageYoyChangePct) : null;
      return v != null && v >= TIGHTNESS_THRESHOLDS.yellow && v < TIGHTNESS_THRESHOLDS.red;
    }
  ).length;

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <Link
          href={`/geographies/${id}`}
          className="text-sm text-[#6B7280] hover:text-[#F97316] transition-colors"
        >
          &larr; {market.shortName} Detail
        </Link>
        <h1 className="text-2xl font-bold text-[#1E293B] mt-2">Trade Bottleneck Analyzer</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          {market.name} · BLS OEWS vintage {latestVintage ?? "—"}
        </p>
      </div>

      {occupations.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-900">
          <p className="font-medium">No occupation data available yet.</p>
          <p className="text-sm mt-1">
            Run the OES pipeline (POST /api/cron/oes) to backfill BLS occupational data for this market.
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Trades Tracked</p>
              <p className="text-3xl font-bold text-[#1E293B] mt-1">{occupations.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Total Employment</p>
              <p className="text-3xl font-bold text-[#1E293B] mt-1">{totalEmp.toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-xl border-l-4 border-red-500 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Tight Trades</p>
              <p className="text-3xl font-bold text-red-700 mt-1">{tightCount}</p>
              <p className="text-[10px] text-[#6B7280] mt-1">Wage growth ≥5% YoY</p>
            </div>
            <div className="bg-white rounded-xl border-l-4 border-amber-500 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Warming Trades</p>
              <p className="text-3xl font-bold text-amber-700 mt-1">{warmingCount}</p>
              <p className="text-[10px] text-[#6B7280] mt-1">3–5% YoY wage growth</p>
            </div>
          </div>

          {/* Tightest trades — what to lock first */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8">
            <div className="px-5 py-4 border-b border-gray-200 bg-gradient-to-r from-orange-50 to-white">
              <h2 className="text-sm font-semibold text-[#1E293B]">Lock These First</h2>
              <p className="text-[11px] text-[#6B7280] mt-0.5">
                Sorted by wage acceleration. Highest growth = tightest labor pool = first contracts to negotiate.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left py-2 px-5 font-medium text-[#6B7280]">SOC</th>
                    <th className="text-left py-2 px-5 font-medium text-[#6B7280]">Occupation</th>
                    <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Workers</th>
                    <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Mean Annual</th>
                    <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Wage YoY</th>
                    <th className="text-right py-2 px-5 font-medium text-[#6B7280]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {byTightness.map((o) => {
                    const yoy = o.wageYoyChangePct != null ? Number(o.wageYoyChangePct) : null;
                    const tag = tightnessClass(yoy);
                    return (
                      <tr key={o.id} className="hover:bg-gray-50">
                        <td className="py-2 px-5 text-xs font-mono text-[#6B7280]">{o.socCode}</td>
                        <td className="py-2 px-5 text-[#1E293B]">{o.socTitle}</td>
                        <td className="py-2 px-5 text-right font-medium text-[#1E293B]">
                          {o.employment != null ? o.employment.toLocaleString() : "—"}
                        </td>
                        <td className="py-2 px-5 text-right text-[#1E293B]">
                          {dollars(o.meanAnnualWage != null ? Number(o.meanAnnualWage) : null)}
                        </td>
                        <td className="py-2 px-5 text-right">
                          <span
                            className={`font-medium ${
                              yoy != null && yoy >= 5
                                ? "text-red-700"
                                : yoy != null && yoy >= 3
                                ? "text-amber-700"
                                : "text-green-700"
                            }`}
                          >
                            {yoy != null ? `${yoy > 0 ? "+" : ""}${yoy.toFixed(1)}%` : "—"}
                          </span>
                        </td>
                        <td className="py-2 px-5 text-right">
                          <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full ${tag.bg} ${tag.text}`}>
                            {tag.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-[11px] text-[#6B7280]">
            Source: BLS Occupational Employment and Wage Statistics (OEWS), cross-industry estimates.
            "Tight" thresholds: ≥5% YoY mean-wage growth = active bidding war; 3–5% = early warning;
            &lt;3% = labor pool relatively ample. Negotiate tight trades first to avoid surprise cost
            escalation as the bid cycle progresses.
          </div>
        </>
      )}
    </div>
  );
}
