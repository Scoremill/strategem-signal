"use client";

/**
 * First-login onboarding flow.
 *
 * Three steps:
 *   1. Welcome — one screen of framing
 *   2. Pick a weighting preset (writes health_score_weights)
 *   3. Pick markets to track (writes tracked_markets)
 *
 * On completion the server action redirects to /heatmap with a
 * populated user state, so the very first page the CEO sees is
 * coherent instead of an empty preset + all 199 markets.
 */
import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import {
  PRESET_ORDER,
  WEIGHT_PRESETS,
  type PresetName,
} from "@/lib/scoring/weight-presets";
import { completeOnboarding } from "./actions";

interface Market {
  id: string;
  shortName: string;
  state: string;
  cbsaFips: string;
}

interface Props {
  userName: string;
  orgName: string;
  markets: Market[];
}

export default function WelcomeClient({ userName, orgName, markets }: Props) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [preset, setPreset] = useState<PresetName>("balanced");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [pending, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filteredMarkets = useMemo(() => {
    if (!query.trim()) return markets;
    const q = query.trim().toLowerCase();
    return markets.filter(
      (m) =>
        m.shortName.toLowerCase().includes(q) ||
        m.state.toLowerCase().includes(q),
    );
  }, [markets, query]);

  function toggleMarket(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    startSave(async () => {
      const result = await completeOnboarding({
        presetName: preset,
        trackedGeographyIds: Array.from(selected),
      });
      // On success the server action redirects; we only land back
      // here on an error, which the action surfaces in `result`.
      if (result && "ok" in result && result.ok === false) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        {/* Brand bar */}
        <div className="mb-6 flex items-center justify-center">
          <Image
            src="/Logo.png"
            alt="StrategemSignal"
            width={862}
            height={153}
            priority
            className="h-10 w-auto"
          />
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          {/* Progress */}
          <div className="px-6 sm:px-8 pt-6">
            <div className="flex items-center gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={
                    "h-1.5 flex-1 rounded-full " +
                    (i <= step ? "bg-[#F97316]" : "bg-gray-200")
                  }
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
              Step {step + 1} of 3
            </p>
          </div>

          <div className="px-6 sm:px-8 py-6 min-h-[380px]">
            {step === 0 && (
              <Step0 userName={userName} orgName={orgName} />
            )}
            {step === 1 && (
              <Step1
                preset={preset}
                onChange={setPreset}
              />
            )}
            {step === 2 && (
              <Step2
                markets={filteredMarkets}
                allCount={markets.length}
                selected={selected}
                query={query}
                onQuery={setQuery}
                onToggle={toggleMarket}
              />
            )}
          </div>

          {error && (
            <div className="mx-6 sm:mx-8 mb-4 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] p-3">
              <p className="text-xs text-[#991B1B]">{error}</p>
            </div>
          )}

          {/* Footer buttons */}
          <div className="px-6 sm:px-8 py-4 border-t border-gray-100 flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setStep((s) => (s === 0 ? 0 : s === 1 ? 0 : 1))
              }
              disabled={step === 0 || pending}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-[#6B7280] hover:text-[#1E293B] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Back
            </button>
            {step < 2 ? (
              <button
                type="button"
                onClick={() =>
                  setStep((s) => (s === 0 ? 1 : s === 1 ? 2 : 2))
                }
                className="rounded-lg bg-[#F97316] hover:bg-[#EA580C] px-4 py-2 text-xs font-semibold text-white transition-colors"
              >
                Continue →
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded-lg bg-[#F97316] hover:bg-[#EA580C] disabled:opacity-60 disabled:cursor-wait px-4 py-2 text-xs font-semibold text-white transition-colors"
              >
                {pending
                  ? "Setting up…"
                  : selected.size > 0
                    ? `Finish · track ${selected.size} market${selected.size === 1 ? "" : "s"}`
                    : "Finish · skip for now"}
              </button>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-[#6B7280]">
          You can change all of these at any time from Settings.
        </p>
      </div>
    </div>
  );
}

// ─── Step 0: Welcome ────────────────────────────────────────────────
function Step0({ userName, orgName }: { userName: string; orgName: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#F97316]">
        Welcome
      </p>
      <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-[#1E293B]">
        Hey {userName} — let&apos;s get you set up.
      </h1>
      <p className="mt-4 text-sm text-[#4B5563] leading-relaxed max-w-2xl">
        StrategemSignal scores every U.S. metro on six strategic filters
        every month, from federal + competitive data sources with full
        traceability. In about sixty seconds we&apos;ll capture two
        things from you so the app opens with context instead of a blank
        map:
      </p>
      <ul className="mt-4 space-y-2 text-sm text-[#4B5563]">
        <li className="flex gap-3">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FFF7ED] text-[11px] font-bold text-[#F97316]">
            1
          </span>
          <span>
            <strong className="text-[#1E293B]">A weighting preset</strong> — how
            you want to blend the three Portfolio Health sub-scores (Financial,
            Demand, Operational) into a composite you see on the heatmap.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FFF7ED] text-[11px] font-bold text-[#F97316]">
            2
          </span>
          <span>
            <strong className="text-[#1E293B]">A starter market list</strong> —
            a handful of metros you&apos;re already paying attention to, so the
            app can highlight your portfolio and alert on it. Optional; you can
            skip this step and pick markets later.
          </span>
        </li>
      </ul>
      <p className="mt-6 text-xs text-[#6B7280]">
        Signed in as <strong className="text-[#1E293B]">{userName}</strong> ·{" "}
        <strong className="text-[#1E293B]">{orgName}</strong>
      </p>
    </div>
  );
}

// ─── Step 1: Pick a weighting preset ────────────────────────────────
function Step1({
  preset,
  onChange,
}: {
  preset: PresetName;
  onChange: (p: PresetName) => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#F97316]">
        Step 2 · Weighting preset
      </p>
      <h2 className="mt-2 text-xl sm:text-2xl font-bold text-[#1E293B]">
        How do you want the composite blended?
      </h2>
      <p className="mt-2 text-sm text-[#6B7280]">
        Each preset weights the three sub-scores differently. Pick the
        one that matches how you&apos;re thinking about markets right
        now — you can change it anytime.
      </p>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PRESET_ORDER.map((name) => {
          const p = WEIGHT_PRESETS[name];
          const active = name === preset;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onChange(name)}
              className={
                "text-left rounded-xl border p-4 transition-colors " +
                (active
                  ? "border-[#F97316] bg-[#FFF7ED] shadow-sm"
                  : "border-gray-200 bg-white hover:border-[#F97316]/50")
              }
              aria-pressed={active}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-bold text-[#1E293B]">
                  {p.label}
                </span>
                <span className="text-[10px] font-mono text-[#6B7280]">
                  {(p.weights.financial * 100).toFixed(0)}/
                  {(p.weights.demand * 100).toFixed(0)}/
                  {(p.weights.operational * 100).toFixed(0)}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-[#4B5563] leading-relaxed">
                {p.description}
              </p>
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] text-[#6B7280]">
        Weights are Financial / Demand / Operational, each summing to
        100%.
      </p>
    </div>
  );
}

// ─── Step 2: Pick markets to track ──────────────────────────────────
function Step2({
  markets,
  allCount,
  selected,
  query,
  onQuery,
  onToggle,
}: {
  markets: Market[];
  allCount: number;
  selected: Set<string>;
  query: string;
  onQuery: (q: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#F97316]">
        Step 3 · Starter market list
      </p>
      <h2 className="mt-2 text-xl sm:text-2xl font-bold text-[#1E293B]">
        Which markets do you watch today?
      </h2>
      <p className="mt-2 text-sm text-[#6B7280]">
        Pick a few to seed your tracked list. This filters the heatmap
        and the markets table to what you care about. Optional — you
        can skip and add markets later.
      </p>

      <div className="mt-4">
        <input
          type="search"
          placeholder={`Search ${allCount.toLocaleString()} metros…`}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white text-[#1E293B] placeholder:text-[#9CA3AF] px-3 py-2 text-sm focus:border-[#F97316] focus:outline-none focus:ring-2 focus:ring-[#FFF7ED]"
        />
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <p className="text-[11px] text-[#6B7280]">
          {selected.size === 0
            ? "No markets selected."
            : `${selected.size} selected.`}
        </p>
        {selected.size > 0 && (
          <p className="text-[11px] text-[#6B7280]">
            {markets.length !== allCount
              ? `${markets.length} matches`
              : ""}
          </p>
        )}
      </div>

      <div className="mt-2 max-h-[260px] overflow-y-auto rounded-lg border border-gray-200 bg-white">
        {markets.length === 0 ? (
          <p className="p-4 text-xs text-[#6B7280]">
            No markets match &quot;{query}&quot;. Try a different search.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {markets.map((m) => {
              const active = selected.has(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(m.id)}
                    className={
                      "w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors " +
                      (active
                        ? "bg-[#FFF7ED] text-[#1E293B]"
                        : "hover:bg-gray-50 text-[#1E293B]")
                    }
                    aria-pressed={active}
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{m.shortName}</span>
                      <span className="text-[#6B7280]">, {m.state}</span>
                    </span>
                    <span
                      className={
                        "shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] " +
                        (active
                          ? "border-[#F97316] bg-[#F97316] text-white"
                          : "border-gray-300 text-transparent")
                      }
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
