/**
 * Business Case page — per-market Phase 3 entry-strategy view.
 *
 * Renders the Organic Entry Model and the Acquisition Entry Model
 * side-by-side for a single market, with the three-bucket portfolio
 * blend (finished/raw/optioned), the QCEW-derived build cost, the
 * full per-bucket breakdown, and a top-line advisory recommendation
 * chip that narrates the right entry path given the data.
 *
 * Phase 3.5 ships the static (default-inputs) view. Phase 3.6 will
 * wire the live sliders via a client-side component that re-runs the
 * pure scorers on the browser.
 *
 * No tenant restriction — same policy as the drilldown page. Every
 * signed-in user can view any market's business case. Save + share
 * (Phase 3.7) will be per-user + per-org.
 */
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { geographies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { loadBusinessCaseInputs, toAcquisitionRawInputs } from "@/lib/business-case/loader";
import { computeOrganicEntry } from "@/lib/business-case/organic-entry-model";
import {
  computeAcquisitionEntry,
  recommendEntryPath,
} from "@/lib/business-case/acquisition-entry-model";
import { DEFAULT_INPUTS } from "@/lib/business-case/types";
import type {
  OrganicBucketOutput,
  OrganicOutput,
  AcquisitionOutput,
} from "@/lib/business-case/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtDollarsFull(n: number | null): string {
  if (n === null) return "—";
  return `$${n.toLocaleString()}`;
}

function fmtPct(n: number | null, digits = 1): string {
  if (n === null) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtMonths(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(n >= 10 ? 0 : 1)} mo`;
}

// ─── Page ──────────────────────────────────────────────────────────

export default async function BusinessCasePage({ params }: PageProps) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const { id } = await params;

  const [market] = await db
    .select()
    .from(geographies)
    .where(eq(geographies.id, id))
    .limit(1);
  if (!market) notFound();

  // Load raw inputs once and compute both models with default CEO inputs
  const raw = await loadBusinessCaseInputs(market.id);
  const organic = computeOrganicEntry(raw.organic, DEFAULT_INPUTS);
  const acquisition = computeAcquisitionEntry(
    toAcquisitionRawInputs(raw.acquisitionTargets, organic.blendedCapitalPerUnit),
    {}
  );
  const rec = recommendEntryPath({
    organicCapitalPerUnit: organic.blendedCapitalPerUnit,
    organicBlendedMargin: organic.blendedGrossMarginPct,
    organicMonthsToFirstClosing: organic.blendedMonthsToFirstClosing,
    acquisitionCostPerUnit: acquisition.estimatedCostPerUnit,
    acquisitionTargetCount: acquisition.targets.length,
  });

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-xs text-[#6B7280]">
        <Link href={`/markets/${market.id}`} className="hover:text-[#1E293B] transition-colors">
          ← {market.shortName}, {market.state}
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E293B]">
          Business Case — {market.shortName}, {market.state}
        </h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Organic entry vs acquisition, with a portfolio-blend land
          position. The numbers below narrate the data from federal and
          competitor sources — the final call is yours.
        </p>
      </div>

      {/* Recommendation chip */}
      <RecommendationBanner recommendation={rec.recommendation} rationale={rec.rationale} />

      {/* Assumptions strip */}
      <AssumptionsStrip organic={organic} />

      {/* Side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <OrganicCard organic={organic} />
        <AcquisitionCard acquisition={acquisition} />
      </div>

      {/* Bucket breakdown */}
      <BucketBreakdown organic={organic} />

      {/* Warnings */}
      <WarningsPanel organic={organic} acquisition={acquisition} />

      {/* Phase 3.6 hint */}
      <div className="mt-10 border-t border-gray-200 pt-6 text-xs text-[#6B7280]">
        Showing the default CEO inputs ({DEFAULT_INPUTS.landSharePct}% land
        share, {DEFAULT_INPUTS.landMix.pctFinished}/
        {DEFAULT_INPUTS.landMix.pctRaw}/
        {DEFAULT_INPUTS.landMix.pctOptioned} finished/raw/optioned mix,
        target {DEFAULT_INPUTS.targetUnitsPerYear} units/yr). Live stress-
        test sliders land next.
      </div>
    </div>
  );
}

// ─── Components ────────────────────────────────────────────────────

function RecommendationBanner({
  recommendation,
  rationale,
}: {
  recommendation: "organic" | "acquisition" | "pass";
  rationale: string;
}) {
  const label =
    recommendation === "organic"
      ? "Lean Organic"
      : recommendation === "acquisition"
      ? "Lean Acquisition"
      : "Pass";
  const bg =
    recommendation === "organic"
      ? "bg-[#FFF7ED] border-[#F97316]"
      : recommendation === "acquisition"
      ? "bg-[#EFF6FF] border-[#3B82F6]"
      : "bg-[#FEF2F2] border-[#EF4444]";
  const textColor =
    recommendation === "organic"
      ? "text-[#9A3412]"
      : recommendation === "acquisition"
      ? "text-[#1E3A5F]"
      : "text-[#991B1B]";
  return (
    <div className={`mb-6 rounded-xl border-l-4 ${bg} p-5`}>
      <div className="flex items-start gap-4">
        <div className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${textColor} bg-white/60`}>
          Advisory · {label}
        </div>
        <p className={`text-sm leading-relaxed ${textColor}`}>{rationale}</p>
      </div>
    </div>
  );
}

function AssumptionsStrip({ organic }: { organic: OrganicOutput }) {
  const a = organic.assumptions;
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-3">
        Market assumptions
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <AssumptionTile
          label="Median home price"
          value={fmtDollarsFull(a.medianHomePrice)}
          sub={a.medianHomePriceAsOf ? `Zillow ZHVI · ${a.medianHomePriceAsOf}` : "Zillow ZHVI"}
        />
        <AssumptionTile
          label="Projected sale price"
          value={fmtDollarsFull(a.projectedSalePrice)}
          sub="+5% new-construction premium"
        />
        <AssumptionTile
          label="Raw land per unit"
          value={fmtDollarsFull(a.landCostPerUnit)}
          sub={`${DEFAULT_INPUTS.landSharePct}% land share`}
        />
        <AssumptionTile
          label="Base build cost"
          value={fmtDollarsFull(a.baseBuildCost)}
          sub="QCEW-derived, 2,200 sqft"
        />
      </div>
    </div>
  );
}

function AssumptionTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[#6B7280]">{label}</p>
      <p className="text-xl font-bold text-[#1E293B] mt-0.5">{value}</p>
      <p className="text-[11px] text-[#6B7280] mt-0.5">{sub}</p>
    </div>
  );
}

function OrganicCard({ organic }: { organic: OrganicOutput }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-lg font-bold text-[#1E293B]">Organic Entry</h2>
        <span className="text-[10px] uppercase tracking-wide text-[#F97316] font-semibold">
          Blended portfolio
        </span>
      </div>
      <p className="text-xs text-[#6B7280] mb-5">
        Build from scratch using a three-bucket land mix.
      </p>

      <StatLine
        label="Capital per unit"
        value={fmtDollarsFull(organic.blendedCapitalPerUnit)}
        emphasis
      />
      <StatLine
        label="Months to first closing"
        value={fmtMonths(organic.blendedMonthsToFirstClosing)}
      />
      <StatLine
        label="Gross margin (blended)"
        value={fmtPct(organic.blendedGrossMarginPct)}
      />
      <StatLine
        label="ROIC (blended)"
        value={fmtPct(organic.blendedRoicPct)}
      />
      <StatLine
        label="Year-one capital deployed"
        value={fmtMoney(organic.yearOneCapitalDeployed)}
      />
    </div>
  );
}

function AcquisitionCard({ acquisition }: { acquisition: AcquisitionOutput }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-lg font-bold text-[#1E293B]">Acquisition Entry</h2>
        <span className="text-[10px] uppercase tracking-wide text-[#3B82F6] font-semibold">
          Comparator
        </span>
      </div>
      <p className="text-xs text-[#6B7280] mb-5">
        Buy a running start — directional only, not a deal quote.
      </p>

      <StatLine
        label="Estimated cost per unit"
        value={fmtDollarsFull(acquisition.estimatedCostPerUnit)}
        emphasis
      />
      <StatLine
        label="Assumed multiple"
        value={`${acquisition.assumedMultiple.toFixed(1)}× organic`}
      />
      <StatLine
        label="Credible targets"
        value={`${acquisition.targets.length} public builder${acquisition.targets.length === 1 ? "" : "s"}`}
      />

      {acquisition.targets.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <p className="text-[10px] uppercase tracking-wide text-[#6B7280] mb-2">
            Who's here
          </p>
          <ul className="space-y-1.5">
            {acquisition.targets.slice(0, 6).map((t) => (
              <li key={t.ticker} className="flex items-center justify-between text-xs">
                <span className="text-[#1E293B]">
                  <span className="font-semibold">{t.ticker}</span>
                  {t.companyName && (
                    <span className="text-[#6B7280]"> · {t.companyName}</span>
                  )}
                </span>
                <span className="text-[#6B7280]">
                  {t.confidence} · {t.mentionCount}×
                </span>
              </li>
            ))}
          </ul>
          {acquisition.targets.length > 6 && (
            <p className="mt-2 text-[11px] text-[#6B7280]">
              +{acquisition.targets.length - 6} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatLine({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-2 border-b border-gray-100 last:border-b-0">
      <span className="text-xs text-[#6B7280]">{label}</span>
      <span
        className={
          emphasis
            ? "text-xl font-bold text-[#F97316]"
            : "text-sm font-semibold text-[#1E293B]"
        }
      >
        {value}
      </span>
    </div>
  );
}

function BucketBreakdown({ organic }: { organic: OrganicOutput }) {
  const buckets: Array<{ name: string; data: OrganicBucketOutput }> = [
    { name: "Finished lots", data: organic.finished },
    { name: "Raw land", data: organic.raw },
    { name: "Optioned", data: organic.optioned },
  ];
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-bold text-[#1E293B]">Portfolio breakdown</h3>
        <p className="text-xs text-[#6B7280] mt-0.5">
          How each land flavor pencils out on its own at the current mix.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-[#FFF7ED]">
          <tr>
            <th className="text-left px-5 py-2.5 text-[10px] uppercase tracking-wide text-[#9A3412] font-semibold">Bucket</th>
            <th className="text-right px-5 py-2.5 text-[10px] uppercase tracking-wide text-[#9A3412] font-semibold">Mix</th>
            <th className="text-right px-5 py-2.5 text-[10px] uppercase tracking-wide text-[#9A3412] font-semibold">Capital / unit</th>
            <th className="text-right px-5 py-2.5 text-[10px] uppercase tracking-wide text-[#9A3412] font-semibold">Months</th>
            <th className="text-right px-5 py-2.5 text-[10px] uppercase tracking-wide text-[#9A3412] font-semibold">Margin</th>
            <th className="text-right px-5 py-2.5 text-[10px] uppercase tracking-wide text-[#9A3412] font-semibold">ROIC</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b, i) => (
            <tr
              key={b.name}
              className={i % 2 === 0 ? "bg-white" : "bg-[#FFF7ED]/40"}
            >
              <td className="px-5 py-3 text-[#1E293B] font-medium">{b.name}</td>
              <td className="px-5 py-3 text-right text-[#1E293B]">{b.data.mixPct}%</td>
              <td className="px-5 py-3 text-right text-[#1E293B]">
                {fmtDollarsFull(b.data.capitalPerUnit)}
              </td>
              <td className="px-5 py-3 text-right text-[#1E293B]">
                {fmtMonths(b.data.monthsToFirstClosing)}
              </td>
              <td className="px-5 py-3 text-right text-[#1E293B]">
                {fmtPct(b.data.grossMarginPct)}
              </td>
              <td className="px-5 py-3 text-right text-[#1E293B]">
                {fmtPct(b.data.roicPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-5 py-4 border-t border-gray-100 space-y-2">
        {buckets.map((b) =>
          b.data.notes.length > 0 ? (
            <div key={b.name} className="text-xs text-[#6B7280]">
              <span className="font-semibold text-[#1E293B]">{b.name}:</span>{" "}
              {b.data.notes.join(" ")}
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}

function WarningsPanel({
  organic,
  acquisition,
}: {
  organic: OrganicOutput;
  acquisition: AcquisitionOutput;
}) {
  const all = [
    ...organic.warnings.map((w) => ({ w, src: "Organic" })),
    ...acquisition.warnings.map((w) => ({ w, src: "Acquisition" })),
  ];
  if (all.length === 0) return null;
  return (
    <div className="rounded-xl border-l-4 border-[#F97316] bg-[#FFF7ED] p-5 mb-6">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-[#9A3412] mb-2">
        Flags for the board
      </p>
      <ul className="space-y-1.5">
        {all.map((x, i) => (
          <li key={i} className="text-sm text-[#9A3412]">
            <span className="font-semibold">{x.src}:</span> {x.w}
          </li>
        ))}
      </ul>
    </div>
  );
}
