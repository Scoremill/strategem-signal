"use client";

/**
 * Business Case client — owns the CEO input state and re-runs the
 * pure scorers on every slider move. The server component above
 * loads raw inputs once; from there, all stress-testing is in-browser
 * with zero round trips.
 *
 * The scorers are pure functions, so this works by just calling them
 * inside useMemo whenever inputs change. Recoil/Zustand/etc. are
 * overkill for a single-page stateful view like this one.
 */
import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { computeOrganicEntry } from "@/lib/business-case/organic-entry-model";
import {
  computeAcquisitionEntry,
  recommendEntryPath,
} from "@/lib/business-case/acquisition-entry-model";
import { DEFAULT_INPUTS } from "@/lib/business-case/types";
import { saveBusinessCase } from "./actions";
import BusinessCasePdfTemplate from "./BusinessCasePdfTemplate";
import { exportElementToPdf } from "./exportPdf";
import type {
  AcquisitionOutput,
  AcquisitionTarget,
  BusinessCaseInputs,
  OrganicBucketOutput,
  OrganicOutput,
} from "@/lib/business-case/types";
import type { OrganicRawInputs } from "@/lib/business-case/organic-entry-model";

// ─── Props ────────────────────────────────────────────────────────

interface Props {
  geographyId: string;
  marketLabel: string;
  rawOrganic: OrganicRawInputs;
  acquisitionTargets: AcquisitionTarget[];
}

// ─── Formatters ───────────────────────────────────────────────────

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

/**
 * Cap the ROIC display to a sane upper bound. Annualizing a 4-month
 * finished-lot cycle produces math like 270% that is mathematically
 * correct but board-room misleading. We show ">150%" instead and leave
 * the raw number in the tooltip for anyone who cares.
 */
function fmtRoic(n: number | null): string {
  if (n === null) return "—";
  if (n > 150) return ">150%";
  return `${n.toFixed(1)}%`;
}

// ─── Component ────────────────────────────────────────────────────

export default function BusinessCaseClient({
  geographyId,
  marketLabel,
  rawOrganic,
  acquisitionTargets,
}: Props) {
  const router = useRouter();
  const [inputs, setInputs] = useState<BusinessCaseInputs>(DEFAULT_INPUTS);
  const [acquisitionMultiple, setAcquisitionMultiple] = useState<number>(2.5);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveNotes, setSaveNotes] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();
  const [pdfMounted, setPdfMounted] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const organic = useMemo(() => computeOrganicEntry(rawOrganic, inputs), [
    rawOrganic,
    inputs,
  ]);

  const acquisition = useMemo<AcquisitionOutput>(
    () =>
      computeAcquisitionEntry(
        {
          targets: acquisitionTargets,
          organicCapitalPerUnit: organic.blendedCapitalPerUnit,
        },
        { multipleOverride: acquisitionMultiple }
      ),
    [acquisitionTargets, organic.blendedCapitalPerUnit, acquisitionMultiple]
  );

  const rec = useMemo(
    () =>
      recommendEntryPath({
        organicCapitalPerUnit: organic.blendedCapitalPerUnit,
        organicBlendedMargin: organic.blendedGrossMarginPct,
        organicMonthsToFirstClosing: organic.blendedMonthsToFirstClosing,
        acquisitionCostPerUnit: acquisition.estimatedCostPerUnit,
        acquisitionTargetCount: acquisition.targets.length,
      }),
    [organic, acquisition]
  );

  // ── Mix helper: keep the three-bucket sum sane while the user edits ──
  function setMix(finished: number, raw: number, optioned: number) {
    setInputs((prev) => ({
      ...prev,
      landMix: { pctFinished: finished, pctRaw: raw, pctOptioned: optioned },
    }));
  }

  function setField<K extends keyof BusinessCaseInputs>(
    key: K,
    value: BusinessCaseInputs[K]
  ) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function resetToDefaults() {
    setInputs(DEFAULT_INPUTS);
    setAcquisitionMultiple(2.5);
  }

  function openSaveDialog() {
    // Seed a sensible default title so the CEO doesn't have to type one
    const date = new Date().toISOString().slice(0, 10);
    const defaultTitle = `${marketLabel} — ${inputs.landSharePct}% land, ${inputs.landMix.pctFinished}/${inputs.landMix.pctRaw}/${inputs.landMix.pctOptioned} mix (${date})`;
    setSaveTitle(defaultTitle);
    setSaveNotes("");
    setSaveMsg(null);
    setSaveOpen(true);
  }

  async function handleExportPdf() {
    if (pdfBusy) return;
    setPdfBusy(true);
    setPdfMounted(true);
    try {
      // Let React flush the hidden template into the DOM before we
      // rasterize. Two RAFs is more reliable than a single setTimeout.
      await new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      });
      const safeMarket = marketLabel.replace(/[^a-zA-Z0-9]+/g, "-");
      const date = new Date().toISOString().slice(0, 10);
      await exportElementToPdf(
        "business-case-pdf-template",
        `StrategemSignal-${safeMarket}-${date}.pdf`
      );
    } catch (err) {
      console.error("PDF export failed", err);
      alert("PDF export failed. See console for details.");
    } finally {
      setPdfMounted(false);
      setPdfBusy(false);
    }
  }

  function handleSave() {
    setSaveMsg(null);
    startSave(async () => {
      const result = await saveBusinessCase({
        geographyId,
        title: saveTitle,
        notes: saveNotes || null,
        inputs,
        organic,
        acquisition,
        recommendation: rec.recommendation,
      });
      if (result.ok) {
        setSaveMsg("Saved.");
        setTimeout(() => {
          setSaveOpen(false);
          router.refresh();
        }, 600);
      } else {
        setSaveMsg(result.error);
      }
    });
  }

  return (
    <>
      {/* Recommendation chip + save button */}
      <div className="mb-6 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <RecommendationBanner
            recommendation={rec.recommendation}
            rationale={rec.rationale}
          />
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={handleExportPdf}
            disabled={pdfBusy}
            className="rounded-lg border border-[#F97316] bg-white hover:bg-[#FFF7ED] disabled:opacity-50 disabled:cursor-wait px-4 py-2 text-xs font-semibold text-[#F97316] transition-colors"
          >
            {pdfBusy ? "Generating…" : "Export PDF"}
          </button>
          <button
            onClick={openSaveDialog}
            className="rounded-lg bg-[#F97316] hover:bg-[#EA580C] px-4 py-2 text-xs font-semibold text-white transition-colors"
          >
            Save case
          </button>
        </div>
      </div>

      {/* Save dialog */}
      {saveOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSaveOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-[#1E293B] mb-1">Save business case</h3>
            <p className="text-xs text-[#6B7280] mb-4">
              Saves the current inputs and results to your library so you can
              revisit the scenario or share it with peers in your org.
            </p>
            <label className="block text-xs font-semibold text-[#1E293B] mb-1">
              Title
            </label>
            <input
              type="text"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white text-[#1E293B] placeholder:text-[#9CA3AF] px-3 py-2 text-sm focus:border-[#F97316] focus:outline-none focus:ring-2 focus:ring-[#FFF7ED]"
              placeholder="e.g. Atlanta — 30% land aggressive optioned"
            />
            <label className="block text-xs font-semibold text-[#1E293B] mt-4 mb-1">
              Notes <span className="font-normal text-[#6B7280]">(optional)</span>
            </label>
            <textarea
              value={saveNotes}
              onChange={(e) => setSaveNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 bg-white text-[#1E293B] placeholder:text-[#9CA3AF] px-3 py-2 text-sm focus:border-[#F97316] focus:outline-none focus:ring-2 focus:ring-[#FFF7ED]"
              placeholder="Why this scenario matters…"
            />
            {saveMsg && (
              <p
                className={`mt-3 text-xs ${
                  saveMsg === "Saved." ? "text-[#10B981]" : "text-[#EF4444]"
                }`}
              >
                {saveMsg}
              </p>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setSaveOpen(false)}
                disabled={isSaving}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-[#6B7280] hover:text-[#1E293B] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !saveTitle.trim()}
                className="rounded-lg bg-[#F97316] hover:bg-[#EA580C] disabled:bg-gray-300 px-4 py-2 text-xs font-semibold text-white transition-colors"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Controls + results side-by-side on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 mb-6">
        {/* Left column — sliders */}
        <ControlsPanel
          inputs={inputs}
          acquisitionMultiple={acquisitionMultiple}
          onField={setField}
          onMix={setMix}
          onMultiple={setAcquisitionMultiple}
          onReset={resetToDefaults}
        />

        {/* Right column — stacked output cards */}
        <div className="space-y-6 min-w-0">
          <AssumptionsStrip organic={organic} inputs={inputs} />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <OrganicCard organic={organic} />
            <AcquisitionCard acquisition={acquisition} />
          </div>
          <BucketBreakdown organic={organic} />
          <WarningsPanel organic={organic} acquisition={acquisition} />
        </div>
      </div>

      {/*
        Hidden PDF template — portalled directly into <body> so it
        escapes the Tailwind cascade (Tailwind v4's oklch() colors
        would otherwise poison html2canvas via inherited `color` on
        unstyled child elements). Only mounted while the user is
        exporting.
      */}
      {pdfMounted &&
        typeof document !== "undefined" &&
        createPortal(
          <BusinessCasePdfTemplate
            id="business-case-pdf-template"
            marketLabel={marketLabel}
            inputs={inputs}
            organic={organic}
            acquisition={acquisition}
            recommendation={rec.recommendation}
            rationale={rec.rationale}
            generatedAt={new Date().toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          />,
          document.body
        )}
    </>
  );
}

// ─── Controls ─────────────────────────────────────────────────────

function ControlsPanel({
  inputs,
  acquisitionMultiple,
  onField,
  onMix,
  onMultiple,
  onReset,
}: {
  inputs: BusinessCaseInputs;
  acquisitionMultiple: number;
  onField: <K extends keyof BusinessCaseInputs>(
    key: K,
    value: BusinessCaseInputs[K]
  ) => void;
  onMix: (f: number, r: number, o: number) => void;
  onMultiple: (m: number) => void;
  onReset: () => void;
}) {
  const mixSum =
    inputs.landMix.pctFinished +
    inputs.landMix.pctRaw +
    inputs.landMix.pctOptioned;
  const mixIsValid = Math.abs(mixSum - 100) <= 0.5;

  return (
    <div className="lg:sticky lg:top-6 self-start rounded-xl border border-gray-200 bg-white p-5 h-fit">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-[#1E293B]">Stress test</h3>
        <button
          onClick={onReset}
          className="text-[10px] uppercase tracking-wide text-[#6B7280] hover:text-[#F97316] transition-colors"
        >
          Reset
        </button>
      </div>

      <SliderField
        label="Land share"
        value={inputs.landSharePct}
        min={10}
        max={50}
        step={1}
        unit="%"
        hint="% of sale price allocated to raw land"
        onChange={(v) => onField("landSharePct", v)}
      />

      <SliderField
        label="Build cost multiplier"
        value={inputs.buildCostMultiplier}
        min={0.8}
        max={1.2}
        step={0.05}
        unit="×"
        decimals={2}
        hint="±20% around QCEW-derived baseline"
        onChange={(v) => onField("buildCostMultiplier", v)}
      />

      <SliderField
        label="Absorption pace"
        value={inputs.absorptionMultiplier}
        min={0.6}
        max={1.4}
        step={0.05}
        unit="×"
        decimals={2}
        hint="1.0× = market-average take-up"
        onChange={(v) => onField("absorptionMultiplier", v)}
      />

      <SliderField
        label="Year-one volume"
        value={inputs.targetUnitsPerYear}
        min={100}
        max={2000}
        step={50}
        unit=" units"
        hint="Target closings in year one"
        onChange={(v) => onField("targetUnitsPerYear", v)}
      />

      {/* Portfolio mix */}
      <div className="mt-5 pt-5 border-t border-gray-100">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-3">
          Portfolio mix
        </p>
        <MixSlider
          label="Finished lots"
          value={inputs.landMix.pctFinished}
          onChange={(v) =>
            onMix(v, inputs.landMix.pctRaw, inputs.landMix.pctOptioned)
          }
          color="#F97316"
        />
        <MixSlider
          label="Raw land"
          value={inputs.landMix.pctRaw}
          onChange={(v) =>
            onMix(inputs.landMix.pctFinished, v, inputs.landMix.pctOptioned)
          }
          color="#3B82F6"
        />
        <MixSlider
          label="Optioned"
          value={inputs.landMix.pctOptioned}
          onChange={(v) =>
            onMix(inputs.landMix.pctFinished, inputs.landMix.pctRaw, v)
          }
          color="#10B981"
        />
        <div
          className={`mt-2 text-[11px] ${
            mixIsValid ? "text-[#6B7280]" : "text-[#EA580C] font-semibold"
          }`}
        >
          Sum: {mixSum}%{mixIsValid ? "" : " — should equal 100"}
        </div>
      </div>

      {/* Acquisition multiple */}
      <div className="mt-5 pt-5 border-t border-gray-100">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-3">
          Acquisition
        </p>
        <SliderField
          label="Multiple"
          value={acquisitionMultiple}
          min={1.5}
          max={4.0}
          step={0.1}
          unit="×"
          decimals={1}
          hint="Premium over organic cost"
          onChange={onMultiple}
        />
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit,
  hint,
  decimals = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint?: string;
  decimals?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-xs font-semibold text-[#1E293B]">{label}</label>
        <span className="text-xs font-bold text-[#F97316]">
          {value.toFixed(decimals)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-gray-200 accent-[#F97316]"
      />
      {hint && <p className="text-[10px] text-[#6B7280] mt-1">{hint}</p>}
    </div>
  );
}

function MixSlider({
  label,
  value,
  color,
  onChange,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-xs text-[#1E293B]">{label}</label>
        <span className="text-xs font-semibold" style={{ color }}>
          {value}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-gray-200"
        style={{ accentColor: color }}
      />
    </div>
  );
}

// ─── Output cards (identical shapes to the server version) ────────

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
    <div className={`rounded-xl border-l-4 ${bg} p-5`}>
      <div className="flex items-start gap-4">
        <div
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${textColor} bg-white/60`}
        >
          Advisory · {label}
        </div>
        <p className={`text-sm leading-relaxed ${textColor}`}>{rationale}</p>
      </div>
    </div>
  );
}

function AssumptionsStrip({
  organic,
  inputs,
}: {
  organic: OrganicOutput;
  inputs: BusinessCaseInputs;
}) {
  const a = organic.assumptions;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-3">
        Market assumptions
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <AssumptionTile
          label="Median home price"
          value={fmtDollarsFull(a.medianHomePrice)}
          sub={
            a.medianHomePriceAsOf
              ? `Zillow ZHVI · ${a.medianHomePriceAsOf}`
              : "Zillow ZHVI"
          }
        />
        <AssumptionTile
          label="Projected sale price"
          value={fmtDollarsFull(a.projectedSalePrice)}
          sub="+5% new-construction premium"
        />
        <AssumptionTile
          label="Raw land per unit"
          value={fmtDollarsFull(a.landCostPerUnit)}
          sub={`${inputs.landSharePct}% land share`}
        />
        <AssumptionTile
          label="Base build cost"
          value={fmtDollarsFull(a.baseBuildCost)}
          sub="QCEW-derived, 2,500 sqft"
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
      <StatLine label="ROIC (blended)" value={fmtRoic(organic.blendedRoicPct)} />
      <StatLine
        label="Year-one capital deployed"
        value={fmtMoney(organic.yearOneCapitalDeployed)}
      />
    </div>
  );
}

function AcquisitionCard({
  acquisition,
}: {
  acquisition: AcquisitionOutput;
}) {
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
        value={`${acquisition.targets.length} public builder${
          acquisition.targets.length === 1 ? "" : "s"
        }`}
      />
      {acquisition.targets.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <p className="text-[10px] uppercase tracking-wide text-[#6B7280] mb-2">
            Who&apos;s here
          </p>
          <ul className="space-y-1.5">
            {acquisition.targets.slice(0, 6).map((t) => (
              <li
                key={t.ticker}
                className="flex items-center justify-between text-xs"
              >
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
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-bold text-[#1E293B]">Portfolio breakdown</h3>
        <p className="text-xs text-[#6B7280] mt-0.5">
          How each land flavor pencils out on its own at the current mix.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#FFF7ED]">
            <tr>
              <th className="text-left px-5 py-2.5 text-[10px] uppercase tracking-wide text-[#9A3412] font-semibold">
                Bucket
              </th>
              <th className="text-right px-5 py-2.5 text-[10px] uppercase tracking-wide text-[#9A3412] font-semibold">
                Mix
              </th>
              <th className="text-right px-5 py-2.5 text-[10px] uppercase tracking-wide text-[#9A3412] font-semibold">
                Capital / unit
              </th>
              <th className="text-right px-5 py-2.5 text-[10px] uppercase tracking-wide text-[#9A3412] font-semibold">
                Months
              </th>
              <th className="text-right px-5 py-2.5 text-[10px] uppercase tracking-wide text-[#9A3412] font-semibold">
                Margin
              </th>
              <th className="text-right px-5 py-2.5 text-[10px] uppercase tracking-wide text-[#9A3412] font-semibold">
                ROIC
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b, i) => (
              <tr
                key={b.name}
                className={i % 2 === 0 ? "bg-white" : "bg-[#FFF7ED]/40"}
              >
                <td className="px-5 py-3 text-[#1E293B] font-medium">
                  {b.name}
                </td>
                <td className="px-5 py-3 text-right text-[#1E293B]">
                  {b.data.mixPct}%
                </td>
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
                  {fmtRoic(b.data.roicPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    <div className="rounded-xl border-l-4 border-[#F97316] bg-[#FFF7ED] p-5">
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
