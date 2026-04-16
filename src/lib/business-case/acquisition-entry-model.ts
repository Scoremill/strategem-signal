/**
 * Acquisition Entry Model — pure scorer.
 *
 * Phase 3.10b scope: surface the public builders operating in the
 * market from Filter 4 as competitive intelligence. The model does
 * NOT compute a per-builder acquisition cost, does NOT apply a
 * blanket multiple to organic capital, and does NOT label any
 * specific builder as an acquisition "target." The CEO decides
 * target suitability — the tool just tells them who's here.
 *
 * Why the rewrite: the prior version multiplied organic capital-per-
 * unit by 2.5× and called it an "acquisition cost comparator." That
 * produced nonsense when a smaller builder (e.g. Beazer, ~5k
 * closings/yr) looked at a market where the incumbents are DHI
 * (~90k/yr) and MTH (~13k/yr) — the small-acquires-large framing
 * is backwards in real homebuilding M&A. We kept the raw targets
 * list (useful competitive signal) and stripped the fake math.
 *
 * Phase 3.11 will rebuild this with a proper total-cost-of-entry
 * model that respects acquirer-vs-target scale, book value, and
 * integration cost.
 */
import type { AcquisitionOutput, AcquisitionTarget } from "./types";

/**
 * Typical industry multiple range kept ONLY so the UI can cite a
 * range (1.5× distressed, 2–3× typical, 3–4× premium) for context.
 * Not applied to any specific builder or target.
 */
const DEFAULT_ACQUISITION_MULTIPLE = 2.5;

export interface AcquisitionRawInputs {
  /** All public builders known to operate in the target market, from Filter 4. */
  targets: AcquisitionTarget[];
  /**
   * Kept in the input shape for backward compatibility with callers
   * but no longer used to compute a per-unit comparator. The CEO
   * decides acquisition suitability; the tool doesn't pretend to.
   */
  organicCapitalPerUnit: number | null;
}

export interface AcquisitionInputs {
  /**
   * Kept for backward compatibility with any saved business case
   * that recorded a multipleOverride. Not applied to any specific
   * builder — the card shows the typical range as context only.
   */
  multipleOverride?: number;
}

export function computeAcquisitionEntry(
  raw: AcquisitionRawInputs,
  inputs: AcquisitionInputs = {}
): AcquisitionOutput {
  const warnings: string[] = [];
  const multiple = inputs.multipleOverride ?? DEFAULT_ACQUISITION_MULTIPLE;

  if (raw.targets.length === 0) {
    warnings.push(
      "No public builders cited this market. Regional and private builders are not yet covered in the Competitive Landscape view."
    );
  }

  // Sort targets so the UI gets highest-confidence, most-cited first.
  const ranked = [...raw.targets].sort((a, b) => {
    const confOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const ac = confOrder[a.confidence.toLowerCase()] ?? 0;
    const bc = confOrder[b.confidence.toLowerCase()] ?? 0;
    if (ac !== bc) return bc - ac;
    return b.mentionCount - a.mentionCount;
  });

  return {
    targets: ranked,
    assumedMultiple: multiple,
    // Explicitly null — we no longer compute a per-unit goodwill
    // comparator. Phase 3.11 will introduce a proper total-cost-of-
    // entry number that respects acquirer vs. target scale.
    estimatedCostPerUnit: null,
    warnings,
  };
}

/**
 * Recommendation helper. With the per-unit acquisition comparator
 * removed, the model only has grounds to recommend "organic" or
 * "pass" — it doesn't know enough about any specific builder to
 * declare "Lean Acquisition" credibly. The CEO decides acquisition
 * on their own read of the Competitive Landscape + Targets cards.
 */
export function recommendEntryPath(args: {
  organicCapitalPerUnit: number | null;
  organicBlendedMargin: number | null;
  organicMonthsToFirstClosing: number | null;
  acquisitionCostPerUnit: number | null;
  acquisitionTargetCount: number;
}): { recommendation: "organic" | "acquisition" | "pass"; rationale: string } {
  const {
    organicCapitalPerUnit,
    organicBlendedMargin,
    organicMonthsToFirstClosing,
  } = args;

  if (organicCapitalPerUnit === null) {
    return {
      recommendation: "pass",
      rationale:
        "Insufficient data for this market (no median home price). Cannot produce an entry recommendation.",
    };
  }
  if (organicBlendedMargin !== null && organicBlendedMargin < 10) {
    return {
      recommendation: "pass",
      rationale: `Blended organic margin of ${organicBlendedMargin.toFixed(1)}% is too thin to justify entry at current inputs. Pull the sliders, revisit the land cost share, or consider a different market.`,
    };
  }

  if (organicBlendedMargin !== null && organicBlendedMargin >= 15) {
    const months =
      organicMonthsToFirstClosing !== null
        ? ` Expected ~${organicMonthsToFirstClosing.toFixed(0)} months to first closing.`
        : "";
    return {
      recommendation: "organic",
      rationale: `Organic entry at $${Math.round(organicCapitalPerUnit).toLocaleString()} per unit produces a ${organicBlendedMargin.toFixed(1)}% blended margin. ${months} Acquisition remains a CEO call — review the Competitive Landscape for incumbents.`,
    };
  }

  return {
    recommendation: "organic",
    rationale: `Organic entry produces the cleanest basis at $${Math.round(organicCapitalPerUnit).toLocaleString()} per unit, though the margin is slim. Stress-test the sliders before committing.`,
  };
}
