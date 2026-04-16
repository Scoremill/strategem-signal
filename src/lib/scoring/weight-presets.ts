/**
 * Weighting presets for the Portfolio Health composite score.
 *
 * Four profiles. No free sliders in Phase 1.3 — Drew's explicit call:
 * "Weighting can complicate if the user chooses a convoluted method."
 * The four presets below cover the meaningful combinations a homebuilder
 * CEO / CFO / COO would actually pick. Each preset's three weights sum
 * to 1.0.
 *
 * Re-blending is client-side at read time: the snapshot table stores the
 * raw three sub-scores, and whichever preset a user has chosen is
 * applied when rendering the heatmap and ranking table. No pipeline
 * re-run is needed when someone flips presets — the sub-scores don't
 * change, only the composite.
 */

export type PresetName = "balanced" | "demand" | "affordability" | "operational";

export interface WeightPreset {
  name: PresetName;
  label: string;
  description: string;
  weights: {
    financial: number;
    demand: number;
    operational: number;
  };
}

export const WEIGHT_PRESETS: Record<PresetName, WeightPreset> = {
  balanced: {
    name: "balanced",
    label: "Balanced",
    description:
      "Default blend. Slight tilt toward affordability runway (Financial) because it compounds over the 5-year entry horizon.",
    weights: { financial: 0.40, demand: 0.30, operational: 0.30 },
  },
  demand: {
    name: "demand",
    label: "Demand-focused",
    description:
      "Prioritize markets with strong homebuilder demand signals — permit growth, net migration, employment trajectory. The classic growth-market lens.",
    weights: { financial: 0.25, demand: 0.50, operational: 0.25 },
  },
  affordability: {
    name: "affordability",
    label: "Affordability-focused",
    description:
      "Lead with financial runway: income growth and absolute income levels vs cost trajectory. Favors markets where buyers can still afford to transact.",
    weights: { financial: 0.55, demand: 0.25, operational: 0.20 },
  },
  operational: {
    name: "operational",
    label: "Operational-focused",
    description:
      "Lead with build feasibility: construction wage pressure and trade employment. Favors markets where you can actually complete on schedule.",
    weights: { financial: 0.25, demand: 0.25, operational: 0.50 },
  },
};

export const PRESET_ORDER: PresetName[] = [
  "balanced",
  "demand",
  "affordability",
  "operational",
];

/**
 * Resolve a preset name from a raw string, defaulting to "balanced" if
 * the input is missing or unrecognized. Tolerates casing drift.
 */
export function resolvePreset(name: string | null | undefined): WeightPreset {
  const key = (name ?? "balanced").toLowerCase() as PresetName;
  return WEIGHT_PRESETS[key] ?? WEIGHT_PRESETS.balanced;
}
