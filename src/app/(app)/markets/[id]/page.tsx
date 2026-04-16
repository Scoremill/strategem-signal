/**
 * Per-market drilldown.
 *
 * CEO requirement 5.2 (board-defense traceability): every insight must
 * be traceable to its source data. This page renders the composite +
 * sub-score breakdown plus a "Data Sources" panel that lists every raw
 * input fed into the score with its value, source pipeline, and as-of
 * date. No hand-waving — if the user drags a Board meeting into a
 * conversation about market X, they can show exactly where each
 * supporting number came from.
 *
 * Not tenant-scoped: the data is public-sector (Census, BLS), so any
 * signed-in user can view any market. Only the composite blending
 * depends on the user (their chosen weighting preset).
 */
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  geographies,
  healthScoreWeights,
  portfolioHealthSnapshots,
  marketNarratives,
} from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { resolvePreset, type WeightPreset } from "@/lib/scoring/weight-presets";
import SourceButton from "@/components/sources/SourceButton";
import { tracesFromPortfolioHealth } from "@/lib/sources/traces";

export const dynamic = "force-dynamic";

interface SourceTrace {
  value: number | null;
  source: string;
  asOf: string;
}

interface InputsJson {
  permitsYoyPct: SourceTrace;
  employmentYoyPct: SourceTrace;
  unemploymentRate: SourceTrace;
  populationChangePct: SourceTrace;
  netDomesticMigration: SourceTrace;
  medianHouseholdIncome: SourceTrace;
  incomeYoyPct: SourceTrace;
  qcewWageYoyPct: SourceTrace;
  qcewEmploymentYoyPct: SourceTrace;
}

/**
 * Display metadata for each input field — how to label it, which
 * sub-score group it belongs to, and how to format its value for a
 * CEO-friendly table.
 */
interface InputDisplay {
  key: keyof InputsJson;
  label: string;
  group: "Financial" | "Demand" | "Operational";
  unit: "pct" | "dollars" | "count" | "rate";
  sourceLabel: string;
}

const INPUT_DISPLAY: InputDisplay[] = [
  {
    key: "medianHouseholdIncome",
    label: "Median household income",
    group: "Financial",
    unit: "dollars",
    sourceLabel: "Census ACS",
  },
  {
    key: "incomeYoyPct",
    label: "Income YoY change",
    group: "Financial",
    unit: "pct",
    sourceLabel: "Census ACS",
  },
  {
    key: "permitsYoyPct",
    label: "Single-family permits YoY",
    group: "Demand",
    unit: "pct",
    sourceLabel: "Census Building Permits",
  },
  {
    key: "employmentYoyPct",
    label: "Total nonfarm employment YoY",
    group: "Demand",
    unit: "pct",
    sourceLabel: "BLS CES",
  },
  {
    key: "populationChangePct",
    label: "Population change YoY",
    group: "Demand",
    unit: "pct",
    sourceLabel: "Census PEP",
  },
  {
    key: "netDomesticMigration",
    label: "Net domestic migration",
    group: "Demand",
    unit: "count",
    sourceLabel: "Census PEP",
  },
  {
    key: "unemploymentRate",
    label: "Unemployment rate",
    group: "Demand",
    unit: "rate",
    sourceLabel: "BLS LAUS",
  },
  {
    key: "qcewWageYoyPct",
    label: "Construction wage YoY (weighted)",
    group: "Operational",
    unit: "pct",
    sourceLabel: "BLS QCEW",
  },
  {
    key: "qcewEmploymentYoyPct",
    label: "Construction employment YoY (weighted)",
    group: "Operational",
    unit: "pct",
    sourceLabel: "BLS QCEW",
  },
];

function formatValue(value: number | null, unit: InputDisplay["unit"]): string {
  if (value == null) return "—";
  if (unit === "pct") {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  }
  if (unit === "dollars") return `$${Math.round(value).toLocaleString()}`;
  if (unit === "count") return Math.round(value).toLocaleString();
  if (unit === "rate") return `${value.toFixed(1)}%`;
  return String(value);
}

function compositeColor(composite: number | null): string {
  if (composite == null) return "#9CA3AF";
  if (composite >= 65) return "#16A34A";
  if (composite >= 55) return "#22C55E";
  if (composite >= 45) return "#EAB308";
  if (composite >= 35) return "#F97316";
  return "#DC2626";
}

function blendComposite(
  financial: number | null,
  demand: number | null,
  operational: number | null,
  weights: WeightPreset["weights"]
): number | null {
  const parts: Array<[number, number]> = [];
  if (financial != null) parts.push([financial, weights.financial]);
  if (demand != null) parts.push([demand, weights.demand]);
  if (operational != null) parts.push([operational, weights.operational]);
  if (parts.length === 0) return null;
  let sum = 0;
  let wsum = 0;
  for (const [s, w] of parts) {
    sum += s * w;
    wsum += w;
  }
  return wsum > 0 ? sum / wsum : null;
}

function toYmd(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MarketDrilldownPage({ params }: PageProps) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const { id } = await params;

  // Market lookup — notFound() if the id is bogus
  const [market] = await db
    .select()
    .from(geographies)
    .where(eq(geographies.id, id))
    .limit(1);
  if (!market) notFound();

  // User's weighting preset — needed to blend the composite the user sees
  const [weightRow] = await db
    .select()
    .from(healthScoreWeights)
    .where(
      and(
        eq(healthScoreWeights.userId, session.userId),
        eq(healthScoreWeights.orgId, session.orgId)
      )
    )
    .limit(1);
  const preset = resolvePreset(weightRow?.presetName);

  // Latest snapshot for THIS market
  const [snap] = await db
    .select()
    .from(portfolioHealthSnapshots)
    .where(eq(portfolioHealthSnapshots.geographyId, market.id))
    .orderBy(desc(portfolioHealthSnapshots.snapshotDate))
    .limit(1);

  // Latest cached narrative for this market (if any). Refreshed
  // monthly by the portfolio-health cron.
  const [narrative] = await db
    .select()
    .from(marketNarratives)
    .where(eq(marketNarratives.geographyId, market.id))
    .orderBy(desc(marketNarratives.snapshotDate))
    .limit(1);

  const financial =
    snap?.financialScore != null ? parseFloat(String(snap.financialScore)) : null;
  const demand =
    snap?.demandScore != null ? parseFloat(String(snap.demandScore)) : null;
  const operational =
    snap?.operationalScore != null
      ? parseFloat(String(snap.operationalScore))
      : null;
  const composite = blendComposite(financial, demand, operational, preset.weights);
  const snapshotDate = toYmd(snap?.snapshotDate);
  const inputs = (snap?.inputsJson as InputsJson | null) ?? null;

  // Group inputs by sub-score for the Data Sources panel
  const byGroup: Record<InputDisplay["group"], InputDisplay[]> = {
    Financial: [],
    Demand: [],
    Operational: [],
  };
  for (const d of INPUT_DISPLAY) byGroup[d.group].push(d);

  // Pre-build the trace arrays the SourceButton needs. Built once
  // server-side so every button hydrates with its slice already
  // shaped. Sub-score buttons filter to only the inputs that fed
  // that sub-score; composite button shows all inputs.
  const allTraces = tracesFromPortfolioHealth(inputs);
  const financialTraces = allTraces.filter((t) =>
    byGroup.Financial.some((d) => d.label === t.label),
  );
  const demandTraces = allTraces.filter((t) =>
    byGroup.Demand.some((d) => d.label === t.label),
  );
  const operationalTraces = allTraces.filter((t) =>
    byGroup.Operational.some((d) => d.label === t.label),
  );
  const marketLabel = `${market.shortName}, ${market.state}`;

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      {/* Breadcrumb / back link */}
      <div className="mb-4 flex items-center gap-2 text-xs text-[#6B7280]">
        <Link href="/markets" className="hover:text-[#1E293B] transition-colors">
          ← Markets
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B]">
            {market.shortName}, {market.state}
          </h1>
          <p className="text-sm text-[#6B7280] mt-1">
            {market.name} · CBSA {market.cbsaFips}
            {snapshotDate && ` · Snapshot ${snapshotDate}`}
          </p>
        </div>
        <Link
          href={`/markets/${market.id}/business-case`}
          className="shrink-0 rounded-lg bg-[#F97316] hover:bg-[#EA580C] px-4 py-2 text-xs font-semibold text-white transition-colors"
        >
          Business Case →
        </Link>
      </div>

      {/*
        Narrative block — two short plain-English blurbs that narrate
        the underlying data. Designed for board-room defensibility:
        the blurbs describe the inputs, they never recommend a
        decision. Both blurbs render if available; a single blurb
        renders solo. The block is omitted entirely if neither exists.
      */}
      {narrative && (narrative.portfolioHealthBlurb || narrative.marketOpportunityBlurb) && (
        <div className="mb-6 space-y-3">
          {narrative.portfolioHealthBlurb && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-2">
                Portfolio Health
              </p>
              <p className="text-sm text-[#1E293B] leading-relaxed">
                {narrative.portfolioHealthBlurb}
              </p>
            </div>
          )}
          {narrative.marketOpportunityBlurb && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-2">
                Market Opportunity
              </p>
              <p className="text-sm text-[#1E293B] leading-relaxed">
                {narrative.marketOpportunityBlurb}
              </p>
            </div>
          )}
        </div>
      )}

      {!snap ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-900">
          <p className="font-semibold">No score available</p>
          <p className="text-sm mt-1">
            This market has not been scored yet. Scores are refreshed monthly
            by the portfolio-health cron job.
          </p>
        </div>
      ) : (
        <>
          {/* Score row — composite circle + three sub-score cards */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
            {/* Composite */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4 lg:col-span-1">
              <div
                className="flex items-center justify-center w-20 h-20 rounded-full text-white text-2xl font-bold flex-shrink-0"
                style={{ backgroundColor: compositeColor(composite) }}
              >
                {composite != null ? composite.toFixed(0) : "—"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                    Composite
                  </p>
                  <SourceButton
                    title={`Composite — ${marketLabel}`}
                    subtitle={`${preset.label}. Blended from all three sub-score inputs at ${(preset.weights.financial * 100).toFixed(0)}/${(preset.weights.demand * 100).toFixed(0)}/${(preset.weights.operational * 100).toFixed(0)} weighting.`}
                    traces={allTraces}
                    ariaLabel="View sources for composite score"
                  />
                </div>
                <p className="text-[11px] text-[#4B5563] mt-0.5">{preset.label}</p>
                <p className="text-[10px] text-[#9CA3AF] mt-0.5">
                  {(preset.weights.financial * 100).toFixed(0)}/
                  {(preset.weights.demand * 100).toFixed(0)}/
                  {(preset.weights.operational * 100).toFixed(0)}
                </p>
              </div>
            </div>

            {/* Financial sub-score */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                  Financial
                </p>
                <SourceButton
                  title={`Financial sub-score — ${marketLabel}`}
                  subtitle="Inputs that fed the Financial sub-score."
                  traces={financialTraces}
                  ariaLabel="View sources for Financial sub-score"
                />
              </div>
              <p className="text-3xl font-bold text-[#1E293B] tabular-nums">
                {financial != null ? financial.toFixed(0) : "—"}
              </p>
              <p className="text-[11px] text-[#6B7280] mt-1">Affordability runway</p>
            </div>

            {/* Demand sub-score */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                  Demand
                </p>
                <SourceButton
                  title={`Demand sub-score — ${marketLabel}`}
                  subtitle="Inputs that fed the Demand sub-score."
                  traces={demandTraces}
                  ariaLabel="View sources for Demand sub-score"
                />
              </div>
              <p className="text-3xl font-bold text-[#1E293B] tabular-nums">
                {demand != null ? demand.toFixed(0) : "—"}
              </p>
              <p className="text-[11px] text-[#6B7280] mt-1">Growth signals</p>
            </div>

            {/* Operational sub-score */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                  Operational
                </p>
                <SourceButton
                  title={`Operational sub-score — ${marketLabel}`}
                  subtitle="Inputs that fed the Operational sub-score."
                  traces={operationalTraces}
                  ariaLabel="View sources for Operational sub-score"
                />
              </div>
              <p className="text-3xl font-bold text-[#1E293B] tabular-nums">
                {operational != null ? operational.toFixed(0) : "—"}
              </p>
              <p className="text-[11px] text-[#6B7280] mt-1">Build feasibility</p>
            </div>
          </div>

          {/* Data Sources panel */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-[#1E293B]">Data Sources</h2>
              <p className="text-[11px] text-[#6B7280] mt-1">
                Every raw input feeding this market&apos;s score, with its
                federal source pipeline and the as-of date of the underlying
                data. If a row shows em dash, the input was not available for
                this market and its weight redistributed to the remaining
                inputs in the same sub-score.
              </p>
            </div>
            {!inputs ? (
              <p className="text-sm text-[#6B7280]">No inputs recorded for this snapshot.</p>
            ) : (
              <div className="space-y-5">
                {(["Financial", "Demand", "Operational"] as const).map((group) => (
                  <div key={group}>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-2">
                      {group}
                    </h3>
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-gray-100">
                        {byGroup[group].map((d) => {
                          const trace = inputs[d.key];
                          return (
                            <tr key={d.key}>
                              <td className="py-2 text-[#1E293B]">{d.label}</td>
                              <td className="py-2 text-right tabular-nums text-[#1E293B] font-medium">
                                {formatValue(trace?.value ?? null, d.unit)}
                              </td>
                              <td className="py-2 pl-4 text-right text-[11px] text-[#6B7280] w-44">
                                {d.sourceLabel}
                              </td>
                              <td className="py-2 pl-4 text-right text-[11px] text-[#9CA3AF] tabular-nums w-24">
                                {trace?.asOf ?? "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
