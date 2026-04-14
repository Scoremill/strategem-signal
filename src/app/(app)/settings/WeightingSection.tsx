"use client";

import { useState, useTransition } from "react";
import { saveWeightPreset } from "./actions";
import {
  PRESET_ORDER,
  WEIGHT_PRESETS,
  type PresetName,
} from "@/lib/scoring/weight-presets";

interface WeightingSectionProps {
  initialPreset: PresetName;
}

export default function WeightingSection({ initialPreset }: WeightingSectionProps) {
  const [selected, setSelected] = useState<PresetName>(initialPreset);
  const [saved, setSaved] = useState<PresetName>(initialPreset);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  const isDirty = selected !== saved;

  function handlePick(name: PresetName) {
    setSelected(name);
    setFeedback(null);
  }

  function handleSave() {
    setFeedback(null);
    startTransition(async () => {
      const result = await saveWeightPreset(selected);
      if (!result.ok) {
        setFeedback({ kind: "error", message: result.error });
        return;
      }
      setSaved(selected);
      setFeedback({
        kind: "success",
        message: `Saved — composite scores now blended using the ${WEIGHT_PRESETS[selected].label} profile`,
      });
    });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#1E293B]">Health Score Weighting</h3>
        <p className="text-[11px] text-[#6B7280] mt-1">
          Pick how the three sub-scores (Financial, Demand, Operational) blend
          into the single composite Portfolio Health score. This is your personal
          view — teammates can pick their own.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PRESET_ORDER.map((name) => {
          const preset = WEIGHT_PRESETS[name];
          const isSelected = selected === name;
          return (
            <button
              type="button"
              key={name}
              onClick={() => handlePick(name)}
              className={`text-left p-4 rounded-lg border-2 transition-all ${
                isSelected
                  ? "border-[#F97316] bg-orange-50"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-semibold ${isSelected ? "text-[#EA580C]" : "text-[#1E293B]"}`}>
                  {preset.label}
                </span>
                {isSelected && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#F97316] text-white">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#6B7280] leading-relaxed mb-3">
                {preset.description}
              </p>
              <div className="flex items-center gap-2 text-[10px] tabular-nums text-[#4B5563]">
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Financial {(preset.weights.financial * 100).toFixed(0)}%
                </span>
                <span className="text-gray-300">·</span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  Demand {(preset.weights.demand * 100).toFixed(0)}%
                </span>
                <span className="text-gray-300">·</span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Operational {(preset.weights.operational * 100).toFixed(0)}%
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {feedback && (
            <p
              className={`text-[11px] ${
                feedback.kind === "success" ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {feedback.message}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || isPending}
          className="px-4 py-2.5 text-sm font-medium rounded-lg bg-[#F97316] text-white hover:bg-[#EA580C] disabled:bg-gray-200 disabled:text-[#9CA3AF] disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
