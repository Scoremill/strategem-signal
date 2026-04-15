/**
 * Types shared between the Organic Entry Model, the Acquisition Entry
 * Model, and the /markets/[id]/business-case page UI. Serializable —
 * these shapes round-trip through business_cases.inputs_json and
 * .organic_outputs_json and .acquisition_outputs_json.
 */

// ─── Inputs ─────────────────────────────────────────────────────
//
// Three-bucket portfolio blend for the organic entry model. Per
// Drew's decision, a real builder's land position is a mix of
// finished lots, raw land, and optioned land. The model computes
// weighted capital and timeline across all three.

export interface LandMix {
  /** Percentage of the land position acquired as finished lots ready
   *  for vertical construction. Higher means faster time-to-closing
   *  but higher per-unit capital. */
  pctFinished: number;
  /** Percentage acquired as raw land requiring horizontal work
   *  (roads, utilities, drainage, entitlement). Cheaper per-unit but
   *  18-36 months before first closing. */
  pctRaw: number;
  /** Percentage held under option (earnest money + takedown fee at
   *  pull). Minimal upfront capital but someone else carries the
   *  land cost. NVR's core strategy. */
  pctOptioned: number;
}

export interface BusinessCaseInputs {
  /**
   * Percentage of the finished home sale price allocated to raw
   * land cost. NAHB's default assumption for Tier 2 metros is 25%;
   * coastal Tier 1 markets can hit 40%+ while interior Tier 3-4
   * metros often sit at 10-15%. Default is 25; UI exposes it as a
   * slider so the CEO can dial to their known cost structure.
   */
  landSharePct: number;

  /**
   * Build cost multiplier applied to the model's base build cost.
   * 1.0 = use the QCEW-derived default; 0.8-1.2 range on the slider
   * lets the CEO stress-test what happens if their actual labor
   * and materials costs are off from the market average.
   */
  buildCostMultiplier: number;

  /**
   * Absorption pace multiplier. 1.0 = the model's default absorption
   * pace for this market based on permits and population growth.
   * Values <1.0 stress-test slow absorption (downturn), >1.0 model a
   * faster take-up than the market average.
   */
  absorptionMultiplier: number;

  /**
   * Target unit volume per year for the entry. Scales everything
   * else — land required, capital deployed, time to steady state.
   * Default 500 (typical year-one target for a new market entry).
   */
  targetUnitsPerYear: number;

  /** Three-bucket land portfolio mix. Must sum to 100. */
  landMix: LandMix;

  /**
   * Horizontal work cost as a percentage of raw land price — only
   * applies to the raw-land bucket. 40% is a reasonable Tier 2
   * default; varies by entitlement difficulty and site conditions.
   */
  horizontalPctOfRaw: number;

  /**
   * Option fee as a percentage of the land price at takedown — only
   * applies to the optioned bucket. 5% is typical; covers earnest
   * money and option extension fees.
   */
  optionFeePct: number;
}

export const DEFAULT_INPUTS: BusinessCaseInputs = {
  landSharePct: 25,
  buildCostMultiplier: 1.0,
  absorptionMultiplier: 1.0,
  targetUnitsPerYear: 500,
  landMix: {
    pctFinished: 50,
    pctRaw: 30,
    pctOptioned: 20,
  },
  horizontalPctOfRaw: 40,
  optionFeePct: 5,
};

// ─── Organic Entry Model outputs ────────────────────────────────
//
// One bucket result per land flavor plus a portfolio-weighted rollup.
// Everything is a number or null (null = data missing for that bucket).

export interface OrganicBucketOutput {
  /** Percentage of the blend this bucket represents (0-100). */
  mixPct: number;
  /** Total capital per unit locked into this bucket (land + build + carry). */
  capitalPerUnit: number | null;
  /** Months from land acquisition to first home closing in this bucket. */
  monthsToFirstClosing: number | null;
  /** Gross margin at projected sale price. */
  grossMarginPct: number | null;
  /** Return on invested capital at steady state. */
  roicPct: number | null;
  /** Notes the scorer wants to surface on the bucket (e.g. "NVR-style"). */
  notes: string[];
}

export interface OrganicOutput {
  /** Portfolio-weighted capital per unit across all three buckets. */
  blendedCapitalPerUnit: number | null;
  /** Weighted months to first closing. */
  blendedMonthsToFirstClosing: number | null;
  /** Weighted gross margin. */
  blendedGrossMarginPct: number | null;
  /** Weighted ROIC. */
  blendedRoicPct: number | null;
  /** Estimated total year-one capital deployed for the target unit volume. */
  yearOneCapitalDeployed: number | null;
  /** Per-bucket breakdown for the UI. */
  finished: OrganicBucketOutput;
  raw: OrganicBucketOutput;
  optioned: OrganicBucketOutput;
  /**
   * Everything the model used to compute the outputs. Let the UI show
   * the assumptions at a glance and the "View Sources" panel trace
   * every dollar back to its source.
   */
  assumptions: {
    medianHomePrice: number | null;
    medianHomePriceAsOf: string | null;
    landCostPerUnit: number | null;
    finishedLotPremium: number | null;
    baseBuildCost: number | null;
    carryingCostPerUnit: number | null;
    projectedSalePrice: number | null;
  };
  /** Human-readable warnings the scorer wants surfaced to the CEO. */
  warnings: string[];
}

// ─── Acquisition Entry Model outputs ────────────────────────────
//
// Targets + typical multiple. Drew's decision: we do NOT try to value
// individual targets with precision. We surface the known public
// builder presence in the market (from Filter 4) and a generic
// industry-typical multiple, then let the CEO compare the acquisition
// cost-per-unit to the organic cost-per-unit side by side.

export interface AcquisitionTarget {
  ticker: string;
  companyName: string | null;
  /** Confidence from Filter 4 — "high" / "medium" / "low". */
  confidence: string;
  /** Year range the builder was cited as operating in this market. */
  firstSeenYear: number | null;
  lastSeenYear: number | null;
  /** Number of earnings narratives that cited this (builder, market) pair. */
  mentionCount: number;
}

export interface AcquisitionOutput {
  /** All public builders known to operate in the market. */
  targets: AcquisitionTarget[];
  /**
   * Industry-standard acquisition multiple applied to the target's
   * trailing twelve months of home closings. Default 2.5x book value
   * per NAHB published comps; CEO can stress-test this.
   */
  assumedMultiple: number;
  /**
   * Estimated acquisition cost per unit at the assumed multiple. This
   * is the "all-in cost to buy one year's worth of a target's closings
   * on paper." It is NOT a deal quote — it's a directional comparator
   * to the organic model's capital per unit.
   */
  estimatedCostPerUnit: number | null;
  /** Human-readable warnings. */
  warnings: string[];
}

// ─── Top-level recommendation ───────────────────────────────────

export type Recommendation = "organic" | "acquisition" | "pass";

export interface BusinessCaseResult {
  organic: OrganicOutput;
  acquisition: AcquisitionOutput;
  recommendation: Recommendation;
  recommendationRationale: string;
}
