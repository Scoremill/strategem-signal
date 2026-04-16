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

/**
 * Market tier classification, set automatically from the market's
 * median home price. Drives the calibrated defaults for square
 * footage, land cost share, base build cost, and new-construction
 * premium — each of these varies meaningfully by metro tier and
 * applying Atlanta-grade defaults to Jackson produced nonsense
 * (Phase 3.10 fix).
 *
 * Four tiers:
 *   A — Low cost (<$250k): small southern/midwest metros
 *   B — Mid cost ($250-550k): Tier 2 Sun Belt metros
 *   C — High cost ($550-900k): West-coast mainland, coastal FL
 *   D — Ultra-high cost (>$900k): coastal CA, NYC, Boston
 */
export type MarketTier = "A" | "B" | "C" | "D";

export interface MarketTierDefaults {
  tier: MarketTier;
  /** Human-readable label for the UI chip. */
  label: string;
  /** Median home square footage for this tier. */
  medianHomeSqft: number;
  /** Default raw land cost share as % of sale price. */
  landCostSharePct: number;
  /** Base build cost $/sqft at the national-median construction wage. */
  baseBuildCostPerSqft: number;
  /**
   * New-construction sale premium over the Zillow ZHVI existing-home
   * median. Larger in small metros where the existing stock is old
   * and small, shrinking toward 5% in coastal metros where the
   * existing stock is closer in age + size to new construction.
   */
  newConstructionPremium: number;
  /** Minimum ZHVI median (inclusive) for this tier, in dollars. */
  zhviMin: number;
  /** Maximum ZHVI median (exclusive) for this tier, in dollars. */
  zhviMax: number;
}

export const MARKET_TIERS: Record<MarketTier, MarketTierDefaults> = {
  A: {
    tier: "A",
    label: "Tier A · Low cost",
    medianHomeSqft: 1800,
    landCostSharePct: 15,
    baseBuildCostPerSqft: 75,
    newConstructionPremium: 1.15,
    zhviMin: 0,
    zhviMax: 250000,
  },
  B: {
    tier: "B",
    label: "Tier B · Mid cost",
    medianHomeSqft: 2200,
    landCostSharePct: 22,
    baseBuildCostPerSqft: 78,
    newConstructionPremium: 1.08,
    zhviMin: 250000,
    zhviMax: 550000,
  },
  C: {
    tier: "C",
    label: "Tier C · High cost",
    medianHomeSqft: 2500,
    landCostSharePct: 30,
    baseBuildCostPerSqft: 85,
    newConstructionPremium: 1.05,
    zhviMin: 550000,
    zhviMax: 900000,
  },
  D: {
    tier: "D",
    label: "Tier D · Ultra-high cost",
    medianHomeSqft: 2500,
    landCostSharePct: 40,
    baseBuildCostPerSqft: 90,
    newConstructionPremium: 1.03,
    zhviMin: 900000,
    zhviMax: Number.POSITIVE_INFINITY,
  },
};

/**
 * Classify a market into a tier from its median home price. Returns
 * Tier B as a safe default when the price is null or the model
 * cannot decide — B is the closest to the national median and the
 * previous single-tier default.
 */
export function classifyMarketTier(
  medianHomePrice: number | null
): MarketTierDefaults {
  if (medianHomePrice == null || !Number.isFinite(medianHomePrice)) {
    return MARKET_TIERS.B;
  }
  if (medianHomePrice < MARKET_TIERS.A.zhviMax) return MARKET_TIERS.A;
  if (medianHomePrice < MARKET_TIERS.B.zhviMax) return MARKET_TIERS.B;
  if (medianHomePrice < MARKET_TIERS.C.zhviMax) return MARKET_TIERS.C;
  return MARKET_TIERS.D;
}

// ─── Operational Execution ──────────────────────────────────────
//
// A single CEO-facing control that encodes a coherent operating
// profile. Moves turns, SG&A, and build-cost efficiency together to
// a credible combination. The CEO picks a posture; the model
// responds. No fantasy-combination failure mode because the three
// levers are coupled.

export type OperationalExecution = "average" | "strong" | "best_in_class";

export interface OperationalExecutionProfile {
  key: OperationalExecution;
  label: string;
  /** One-line description grounded in real-world operator language. */
  description: string;
  /** Turns/yr by bucket at this execution level. */
  turnsByBucket: {
    finished: number;
    raw: number;
    optioned: number;
  };
  /**
   * Multiplier on the per-bucket SG&A defaults (finished 8%, raw 10%,
   * optioned 6%). <1.0 = leaner overhead, >1.0 = heavier. Strong/Best
   * operators run leaner.
   */
  sgaMultiplier: number;
  /**
   * Multiplier on the tier's base build cost. Strong/Best operators
   * get real unit savings from purchasing discipline and lower
   * rework — typically 5-10% below market.
   */
  buildCostMultiplier: number;
}

export const EXECUTION_PROFILES: Record<
  OperationalExecution,
  OperationalExecutionProfile
> = {
  average: {
    key: "average",
    label: "Average",
    description:
      "Industry-median execution. Turns, SG&A, and build cost in line with the public-builder peer group (LEN, DHI, PHM).",
    turnsByBucket: { finished: 2.5, raw: 1.0, optioned: 3.0 },
    sgaMultiplier: 1.0,
    buildCostMultiplier: 1.0,
  },
  strong: {
    key: "strong",
    label: "Strong",
    description:
      "Above the public-builder median. Top divisions of a top-20 builder: faster turns, sub-9% SG&A, meaningful purchasing leverage.",
    turnsByBucket: { finished: 3.0, raw: 1.25, optioned: 3.5 },
    sgaMultiplier: 0.85,
    buildCostMultiplier: 0.95,
  },
  best_in_class: {
    key: "best_in_class",
    label: "Best-in-class",
    description:
      "NVR-style. Best-in-industry turns, ~7% SG&A, and deep purchasing discipline that earns ~10% below-market hard costs.",
    turnsByBucket: { finished: 3.25, raw: 1.5, optioned: 4.0 },
    sgaMultiplier: 0.75,
    buildCostMultiplier: 0.9,
  },
};

export interface BusinessCaseInputs {
  /**
   * Percentage of the finished home sale price allocated to raw
   * land cost. Defaulted from the market's tier (Tier A ~15%,
   * Tier B ~22%, Tier C ~30%, Tier D ~40%). UI exposes it as a
   * slider so the CEO can dial to their known cost structure.
   */
  landCostSharePct: number;

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

  /**
   * Operational execution posture. Single CEO-facing control that
   * moves turns, SG&A, and build-cost efficiency together to a
   * coherent combination. Defaults to "average" for every new case
   * so the first number the CEO sees is the honest baseline — not
   * a flattering stretch scenario.
   */
  operationalExecution: OperationalExecution;
}

/**
 * Legacy static defaults — calibrated to Tier B at Average execution.
 * Kept for backward compatibility with any code paths that haven't
 * been moved to the tier-aware `defaultInputsForTier()` helper below.
 * New code should always go through `defaultInputsForTier()` so the
 * CEO sees the right starting point for the market they're looking at.
 */
export const DEFAULT_INPUTS: BusinessCaseInputs = {
  landCostSharePct: 22,
  absorptionMultiplier: 1.0,
  targetUnitsPerYear: 500,
  landMix: {
    pctFinished: 50,
    pctRaw: 30,
    pctOptioned: 20,
  },
  horizontalPctOfRaw: 40,
  optionFeePct: 5,
  operationalExecution: "average",
};

/**
 * Tier-aware defaults. The land cost share flexes per tier; the
 * rest of the inputs (absorption, mix, operational execution) are
 * the same across tiers because those are CEO-level levers, not
 * market-structure levers.
 */
export function defaultInputsForTier(
  tier: MarketTierDefaults
): BusinessCaseInputs {
  return {
    ...DEFAULT_INPUTS,
    landCostSharePct: tier.landCostSharePct,
  };
}

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
  /**
   * Gross margin at projected sale price, AFTER the 5-point haircut
   * for commissions, closing costs, and interest capitalized into
   * cost of sales. Matches how LEN / DHI / PHM report homebuilding
   * gross margin in their 10-Ks.
   */
  grossMarginPct: number | null;
  /**
   * Capital turns per year for this bucket. Reflects how many times a
   * dollar of invested capital cycles through a cost-of-sales
   * computation per year, given the bucket's land structure AND the
   * chosen operational execution posture.
   */
  capitalTurnsPerYear: number | null;
  /**
   * Cycle contribution: gross margin × turns, PRE-SG&A. This is the
   * community-level capital efficiency number — what the gross margin
   * would return on invested capital if SG&A, interest, and taxes were
   * zero. Reported alongside estimatedRoicPct to prevent confusion.
   */
  cycleContributionPct: number | null;
  /**
   * Estimated ROIC post a per-bucket SG&A haircut. This is the honest
   * CEO-facing number — what the bucket's capital is expected to earn
   * after corporate overhead is subtracted. Will be well below cycle
   * contribution; that's the whole point of showing both.
   */
  estimatedRoicPct: number | null;
  /** The SG&A % applied to this bucket (for the assumptions drawer). */
  sgaPct: number;
  /** Notes the scorer wants to surface on the bucket (e.g. "NVR-style"). */
  notes: string[];
}

export interface OrganicOutput {
  /**
   * Market tier classification driving the calibrated defaults
   * (sqft, land share, build cost, sale premium). Exposed so the
   * UI can show a "Tier A · Low cost" chip next to the market name.
   */
  tier: MarketTier;
  tierLabel: string;
  /**
   * Operational execution posture used for this computation. Exposed
   * so the UI + PDF can badge a saved case as "Strong execution" or
   * "Best-in-class execution" and prevent anyone confusing a stretch
   * scenario for baseline.
   */
  execution: OperationalExecution;
  executionLabel: string;
  /** Portfolio-weighted capital per unit across all three buckets. */
  blendedCapitalPerUnit: number | null;
  /** Weighted months to first closing. */
  blendedMonthsToFirstClosing: number | null;
  /** Weighted gross margin (post haircut, matches public builder reporting). */
  blendedGrossMarginPct: number | null;
  /** Weighted capital turns per year across all three buckets. */
  blendedCapitalTurnsPerYear: number | null;
  /** Weighted cycle contribution (pre-SG&A). */
  blendedCycleContributionPct: number | null;
  /** Weighted estimated ROIC (post a per-bucket SG&A haircut). */
  blendedEstimatedRoicPct: number | null;
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
    /** Median home sqft used for the build-cost calc (from tier). */
    medianHomeSqft: number | null;
    /** Base build cost $/sqft used for the calc (from tier). */
    baseBuildCostPerSqft: number | null;
    /** New-construction sale premium applied to the ZHVI median. */
    newConstructionPremium: number | null;
  };
  /** Human-readable warnings the scorer wants surfaced to the CEO. */
  warnings: string[];
}

// ─── Acquisition Entry Model outputs ────────────────────────────
//
// Targets + typical multiple. Drew's decision: we do NOT try to value
// individual targets with precision. We surface the known public
// builder presence in the market (from Filter 4) and a generic
// industry-typical multiple. Phase 3.11 will rebuild this as a
// total-cost-of-entry comparison against organic; for now the number
// is clearly labeled as a goodwill-inclusive comparator, not a
// per-unit production cost.

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
   * Goodwill-inclusive comparator: what the CEO should expect to pay
   * at close, per future steady-state unit, to acquire a running
   * start in the market. NOT the cost to produce each home under
   * the acquired business — that reverts to market-rate post-close.
   * Phase 3.11 will replace this with a proper total-cost-of-entry
   * model.
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
