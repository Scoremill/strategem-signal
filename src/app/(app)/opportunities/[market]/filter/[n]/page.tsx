/**
 * Filter drilldown page — /opportunities/[market]/filter/[n]
 *
 * CEO requirement section 5.1: every filter score must be one click
 * away from its underlying inputs with the data source clearly
 * labeled. This page is that click. For the 4 real filters, it shows:
 *   - Filter label, description, and the one-liner of how it scores
 *   - The market's raw inputs from the latest snapshot's inputs_json
 *   - A source trace row per input (value, source pipeline, as-of)
 *
 * For the 2 stubbed filters (Competitive Landscape, Affordability
 * Runway), it shows the same shell with a "coming soon" banner
 * explaining the data dependency.
 */
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  geographies,
  marketOpportunityScores,
} from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  FILTER_META,
  type FilterMeta,
  type MarketOpportunityInputs,
} from "@/lib/scoring/market-opportunity";

export const dynamic = "force-dynamic";

/**
 * Display metadata for each input field in MarketOpportunityInputs.
 * Used to render the Data Sources table with human-friendly labels,
 * formatted values, and the filter grouping.
 */
interface InputDisplay {
  key: keyof Omit<MarketOpportunityInputs, "sectorEmployment">;
  label: string;
  unit: "pct" | "dollars" | "count" | "population";
  sourceLabel: string;
  filterN: 1 | 2 | 3 | 6;
}

const INPUT_DISPLAY: InputDisplay[] = [
  // Filter 1 — Migration
  {
    key: "netDomesticMigration",
    label: "Net domestic migration",
    unit: "count",
    sourceLabel: "Census PEP",
    filterN: 1,
  },
  {
    key: "totalPopulation",
    label: "Total population",
    unit: "population",
    sourceLabel: "Census PEP",
    filterN: 1,
  },
  {
    key: "priorYearPopulation",
    label: "Prior-year population",
    unit: "population",
    sourceLabel: "Census PEP",
    filterN: 1,
  },
  // Filter 3 — Imbalance (shares some inputs with other filters)
  {
    key: "permitsYoyPct",
    label: "Single-family permits YoY",
    unit: "pct",
    sourceLabel: "Census Building Permits",
    filterN: 3,
  },
  {
    key: "populationChangePct",
    label: "Population change YoY",
    unit: "pct",
    sourceLabel: "Census PEP",
    filterN: 3,
  },
  // Filter 6 — Operational
  {
    key: "qcewWageYoyPct",
    label: "Construction wage YoY (weighted)",
    unit: "pct",
    sourceLabel: "BLS QCEW",
    filterN: 6,
  },
  {
    key: "qcewEmploymentYoyPct",
    label: "Construction employment YoY (weighted)",
    unit: "pct",
    sourceLabel: "BLS QCEW",
    filterN: 6,
  },
];

function formatValue(v: number | null, unit: InputDisplay["unit"]): string {
  if (v == null) return "—";
  if (unit === "pct") {
    const sign = v > 0 ? "+" : "";
    return `${sign}${v.toFixed(1)}%`;
  }
  if (unit === "dollars") return `$${Math.round(v).toLocaleString()}`;
  if (unit === "count" || unit === "population") return Math.round(v).toLocaleString();
  return String(v);
}

function compositeColor(score: number | null): string {
  if (score == null) return "#9CA3AF";
  if (score >= 65) return "#16A34A";
  if (score >= 55) return "#22C55E";
  if (score >= 45) return "#EAB308";
  if (score >= 35) return "#F97316";
  return "#DC2626";
}

function toYmd(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

/**
 * Pull a filter's score from a snapshot row by its column number.
 */
function scoreForFilter(
  snap: typeof marketOpportunityScores.$inferSelect | undefined,
  n: number
): number | null {
  if (!snap) return null;
  const raw =
    n === 1 ? snap.filter1Migration
      : n === 2 ? snap.filter2Diversity
      : n === 3 ? snap.filter3Imbalance
      : n === 4 ? snap.filter4Competitive
      : n === 5 ? snap.filter5Affordability
      : n === 6 ? snap.filter6Operational
      : null;
  return raw != null ? parseFloat(String(raw)) : null;
}

interface PageProps {
  params: Promise<{ market: string; n: string }>;
}

export default async function FilterDrilldownPage({ params }: PageProps) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const { market: marketId, n: nParam } = await params;
  const n = parseInt(nParam, 10);
  if (![1, 2, 3, 4, 5, 6].includes(n)) notFound();
  const meta: FilterMeta | undefined = FILTER_META.find((f) => f.n === n);
  if (!meta) notFound();

  const [market] = await db
    .select()
    .from(geographies)
    .where(eq(geographies.id, marketId))
    .limit(1);
  if (!market) notFound();

  const [snap] = await db
    .select()
    .from(marketOpportunityScores)
    .where(eq(marketOpportunityScores.geographyId, market.id))
    .orderBy(desc(marketOpportunityScores.snapshotDate))
    .limit(1);

  const score = scoreForFilter(snap, n);
  const isGreen = score != null && score >= 60;
  const snapshotDate = toYmd(snap?.snapshotDate);
  const inputs = (snap?.inputsJson as MarketOpportunityInputs | null) ?? null;

  // Inputs used by this specific filter. For Filter 2 (Diversity) we
  // show the sector breakdown as a mini-table instead of the generic
  // input rows.
  const filterInputs = INPUT_DISPLAY.filter((d) => d.filterN === n);

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      {/* Breadcrumb / back link */}
      <div className="mb-4 flex items-center gap-2 text-xs text-[#6B7280]">
        <Link href="/opportunities" className="hover:text-[#1E293B] transition-colors">
          ← Opportunities
        </Link>
        <span>·</span>
        <Link href={`/markets/${market.id}`} className="hover:text-[#1E293B] transition-colors">
          {market.shortName}, {market.state}
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E293B]">
          Filter {n}: {meta.label}
        </h1>
        <p className="text-sm text-[#6B7280] mt-1">
          {market.shortName}, {market.state}
          {snapshotDate && ` · Snapshot ${snapshotDate}`}
        </p>
      </div>

      {/* Score card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 flex items-center gap-5">
        <div
          className="flex items-center justify-center w-24 h-24 rounded-full text-white text-3xl font-bold flex-shrink-0"
          style={{ backgroundColor: compositeColor(score) }}
        >
          {score != null ? score.toFixed(0) : "—"}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
            Filter Score
          </p>
          <p className="text-sm text-[#4B5563] mt-1">{meta.description}</p>
          {score != null && (
            <p className="text-[11px] text-[#6B7280] mt-2">
              {isGreen ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Passes (≥60 threshold)
                </span>
              ) : (
                <span className="text-amber-700">Below passing threshold (60)</span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Stub banner for filters 4 and 5 */}
      {meta.isStub && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-amber-900">Data pending</h3>
          <p className="text-[12px] text-amber-900 mt-1">
            {n === 4 ? (
              <>
                Competitive Landscape needs a builder→market mapping that
                StrategemOps doesn&apos;t carry yet. Public builders report
                company-level totals, not per-MSA unit volume. A future
                release will parse per-filing disclosures at the MSA level
                to light up this filter.
              </>
            ) : (
              <>
                Affordability Runway needs the FHFA House Price Index
                pipeline, which is scheduled for the release immediately
                before the Phase 3 Business Case Engine (which also
                depends on it). Income and wage data from Census ACS and
                BLS QCEW are available on the per-market drilldown at{" "}
                <Link href={`/markets/${market.id}`} className="underline">
                  /markets/{market.shortName.replace(/\s/g, "-")}
                </Link>{" "}
                in the meantime.
              </>
            )}
          </p>
        </div>
      )}

      {/* Data Sources — only for non-stub filters with real inputs */}
      {!meta.isStub && inputs && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-[#1E293B]">Data Sources</h2>
            <p className="text-[11px] text-[#6B7280] mt-1">
              Every raw input feeding this filter&apos;s score, with its
              federal source pipeline and the as-of date. Em dash means the
              input was not available for this market.
            </p>
          </div>

          {n === 2 ? (
            <SectorBreakdownTable inputs={inputs} />
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {filterInputs.map((d) => {
                  const trace = inputs[d.key];
                  const val = trace?.value ?? null;
                  return (
                    <tr key={d.key}>
                      <td className="py-2 text-[#1E293B]">{d.label}</td>
                      <td className="py-2 text-right tabular-nums text-[#1E293B] font-medium">
                        {formatValue(val, d.unit)}
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
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Filter 2 (Employment Diversity) shows the underlying sector breakdown
 * rather than a flat list of inputs — the actual HHI components are the
 * per-sector employment shares, which is a different shape than the
 * other filters' inputs.
 */
function SectorBreakdownTable({ inputs }: { inputs: MarketOpportunityInputs }) {
  const breakdown = inputs.sectorEmployment.breakdown;
  if (!breakdown || Object.keys(breakdown).length === 0) {
    return (
      <p className="text-sm text-[#6B7280]">
        No sector breakdown available for this market.
      </p>
    );
  }
  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const asOf = inputs.sectorEmployment.asOf || "—";
  return (
    <div>
      <p className="text-[11px] text-[#6B7280] mb-3">
        BLS QCEW 2-digit NAICS supersector employment ({entries.length} sectors,
        {" "}
        {Math.round(total).toLocaleString()} private-sector jobs total).
        As of {asOf}. HHI is computed across the shares below.
      </p>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {entries.map(([sector, emp]) => {
            const share = (emp / total) * 100;
            return (
              <tr key={sector}>
                <td className="py-2 text-[11px] text-[#6B7280] w-16 tabular-nums">
                  NAICS {sector}
                </td>
                <td className="py-2 text-[#1E293B]">{SECTOR_LABELS[sector] ?? sector}</td>
                <td className="py-2 text-right tabular-nums text-[#1E293B] font-medium">
                  {emp.toLocaleString()}
                </td>
                <td className="py-2 pl-4 text-right text-[11px] text-[#6B7280] tabular-nums w-20">
                  {share.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SECTOR_LABELS: Record<string, string> = {
  "11": "Agriculture, Forestry, Fishing & Hunting",
  "21": "Mining, Quarrying, Oil & Gas Extraction",
  "22": "Utilities",
  "23": "Construction",
  "31-33": "Manufacturing",
  "42": "Wholesale Trade",
  "44-45": "Retail Trade",
  "48-49": "Transportation & Warehousing",
  "51": "Information",
  "52": "Finance & Insurance",
  "53": "Real Estate & Rental",
  "54": "Professional, Scientific & Technical Services",
  "55": "Management of Companies",
  "56": "Administrative & Waste Services",
  "61": "Educational Services",
  "62": "Health Care & Social Assistance",
  "71": "Arts, Entertainment & Recreation",
  "72": "Accommodation & Food Services",
  "81": "Other Services",
  "92": "Public Administration",
};
