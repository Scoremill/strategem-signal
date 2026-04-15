/**
 * Acquisition Entry Model — pure scorer.
 *
 * Drew's Phase 3 decision: we do NOT try to value individual targets
 * with precision. That's an M&A team's job with a data room, and the
 * signal would be garbage without one. What we CAN do is surface the
 * public builders known to operate in a market (from Filter 4) plus a
 * generic industry-typical acquisition multiple, and compute an
 * estimated cost-per-unit that sits side-by-side with the organic
 * model's number.
 *
 * The value of this view: it lets the CEO say in a board room, "To
 * enter Denver organically costs $X per unit. To buy our way in at a
 * typical 2.5x multiple of a target like LEN's Denver division costs
 * roughly $Y per unit. Here is why one wins over the other given our
 * capital situation, our time-to-impact target, and our tolerance for
 * integration risk."
 *
 * Design decisions (locked with Drew during Phase 3.2):
 *
 *   1. Targets come from Filter 4 (ops_builder_markets). Those are the
 *      builders whose earnings narratives cite the market by name.
 *      Confidence ranks high/medium/low per the extractor.
 *
 *   2. The default assumed multiple is 2.5x book value. That is the
 *      broad industry range per NAHB published comparables for public
 *      homebuilder roll-ups. CEO can override via slider in Phase 3.6.
 *
 *   3. Estimated cost per unit is computed as:
 *        assumedMultiple × blendedCapitalPerUnit(organic model)
 *      This is NOT a valuation. It is a directional comparator to the
 *      organic cost-per-unit so the CEO can reason about whether
 *      "paying 2.5x for a running start" pencils out versus "building
 *      from scratch at 1.0x but waiting 18 months."
 *
 *   4. No target-specific cost per unit. If we started pricing
 *      individual builders we would mislead the CEO — the actual deal
 *      price depends on a thousand private diligence items we can't
 *      see from public data.
 */
import type {
  AcquisitionOutput,
  AcquisitionTarget,
} from "./types";

/** Industry-standard acquisition multiple per NAHB published comps. */
const DEFAULT_ACQUISITION_MULTIPLE = 2.5;

export interface AcquisitionRawInputs {
  /** All public builders known to operate in the target market, from Filter 4. */
  targets: AcquisitionTarget[];
  /**
   * Organic model blended capital per unit for the same market. We
   * use this as the base for the acquisition cost comparator — the
   * idea being "what a running start on the same ground costs."
   */
  organicCapitalPerUnit: number | null;
}

export interface AcquisitionInputs {
  /**
   * User-tunable multiple. Defaults to 2.5x. CEO can stress-test
   * between ~1.5x (distressed) and ~4x (premium roll-up).
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
      "No public builders cited this market in their earnings narratives (Filter 4). Acquisition entry is likely infeasible — there is no running start to buy."
    );
  }

  let estimatedCostPerUnit: number | null = null;
  if (raw.organicCapitalPerUnit !== null && raw.organicCapitalPerUnit > 0) {
    estimatedCostPerUnit = Math.round(raw.organicCapitalPerUnit * multiple);
  } else {
    warnings.push(
      "Organic cost per unit unavailable — cannot derive acquisition comparator."
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
    estimatedCostPerUnit,
    warnings,
  };
}

/**
 * Side-by-side recommendation helper. Returns one of:
 *   "organic"      — organic entry is clearly cheaper per unit
 *   "acquisition"  — acquisition gets you in fast enough that time value offsets the premium
 *   "pass"         — neither path is attractive (margins too thin, no targets)
 *
 * Rationale is a plain-English one-liner the UI surfaces as a chip.
 * The recommendation is advisory, not prescriptive — per Drew's core
 * principle, the app narrates the data and the CEO makes the call.
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
    acquisitionCostPerUnit,
    acquisitionTargetCount,
  } = args;

  // Pass case — nothing to recommend
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
      rationale: `Blended organic margin of ${organicBlendedMargin.toFixed(1)}% is too thin to justify either entry path. Consider a different market or revisit the portfolio mix.`,
    };
  }

  // If organic is slow AND there are credible targets at a reasonable premium,
  // favor acquisition to capture time value.
  const organicIsSlow =
    organicMonthsToFirstClosing !== null && organicMonthsToFirstClosing >= 15;
  const acquisitionIsCredible =
    acquisitionTargetCount >= 2 && acquisitionCostPerUnit !== null;

  if (organicIsSlow && acquisitionIsCredible && acquisitionCostPerUnit !== null) {
    const premium = acquisitionCostPerUnit / organicCapitalPerUnit;
    if (premium <= 3.0) {
      return {
        recommendation: "acquisition",
        rationale: `Organic entry takes ~${organicMonthsToFirstClosing!.toFixed(0)} months to first closing. With ${acquisitionTargetCount} credible public builders already operating here, acquiring one at ~${premium.toFixed(1)}x cost-per-unit gets you a running start in months rather than years.`,
      };
    }
  }

  // Default: organic if the margin is healthy
  if (organicBlendedMargin !== null && organicBlendedMargin >= 15) {
    return {
      recommendation: "organic",
      rationale: `Organic entry at $${Math.round(organicCapitalPerUnit).toLocaleString()} per unit produces a ${organicBlendedMargin.toFixed(1)}% blended margin on the portfolio mix. Acquisition path adds roughly ${acquisitionCostPerUnit !== null ? `${(acquisitionCostPerUnit / organicCapitalPerUnit).toFixed(1)}x` : "a typical 2.5x"} premium without a corresponding margin lift.`,
    };
  }

  return {
    recommendation: "organic",
    rationale: `Organic entry produces the cleanest risk-adjusted basis at $${Math.round(organicCapitalPerUnit).toLocaleString()} per unit, though the margin is slim. Consider stress-testing the land-mix sliders before committing.`,
  };
}
