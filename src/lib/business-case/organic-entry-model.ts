/**
 * Organic Entry Model — pure scorer.
 *
 * Given a market's median home price (Zillow ZHVI), construction labor
 * cost (QCEW avg weekly wage for NAICS 2382/2383), and a set of CEO
 * inputs (land share %, portfolio mix, absorption multiplier, etc.),
 * compute the per-unit capital, time-to-closing, gross margin, and
 * ROIC for each of three land-flavor buckets plus a portfolio-weighted
 * rollup.
 *
 * Design decisions (locked with Drew during Phase 3.2):
 *
 *   1. Three-bucket portfolio blend (Option B). Real builders mix
 *      finished lots, raw land, and optioned land. The model never
 *      forces an all-one-bucket position.
 *
 *   2. Median home price drives both land cost and projected sale
 *      price. landSharePct (default 25%) is the lever the CEO pulls
 *      to match their known cost structure.
 *
 *   3. Build cost is derived from QCEW construction wages, not a
 *      hardcoded $/sqft figure. The buildCostMultiplier slider lets
 *      the CEO stress-test ±20% from the QCEW-derived baseline.
 *
 *   4. Finished lots carry a 20% premium over raw land cost (NAHB
 *      published comps). Raw land bucket adds a horizontal cost line
 *      (default 40% of raw land price). Optioned bucket pays the
 *      option fee (default 5%) upfront and only the takedown at pull.
 *
 *   5. Carry costs are approximated at 8% annual on deployed capital.
 *      Months-to-first-closing per bucket: finished 4, raw 24, optioned
 *      6. These are the Phase 3 defaults; the UI can expose them later.
 *
 *   6. Pure function, no DB imports. The pipeline/API layer reads
 *      Zillow ZHVI and QCEW, formats them as OrganicRawInputs, and
 *      passes them in. Makes the math trivially testable.
 */
import type {
  BusinessCaseInputs,
  OrganicBucketOutput,
  OrganicOutput,
} from "./types";

// ─── Constants (calibrated defaults) ──────────────────────────────

/** Premium a finished lot costs over raw land, per NAHB comps. */
const FINISHED_LOT_PREMIUM_PCT = 0.20;

/** Months from land control to first home closing by flavor. */
const MONTHS_TO_FIRST_CLOSING = {
  finished: 4,
  raw: 24,
  optioned: 6,
} as const;

/**
 * Capital turns per year, per bucket. This is NOT 12 / months-to-first-
 * closing — that would be an annualization trick. Real community-level
 * turns depend on how long capital stays locked into the LAND portion
 * of the basis:
 *
 *   - Finished lots: ~3 turns. Vertical cycle is ~4 months, and because
 *     you bought finished lots you can redeploy the capital into new
 *     lots each cycle. Slightly below the raw 12/4 ideal because of
 *     absorption friction between cycles (permits, sales cadence).
 *
 *   - Raw land: ~1 turn. Land sits on the balance sheet through the
 *     full development + absorption arc of a community (~3-4 years for
 *     a 150-unit community at 40 closings/yr). Capital is effectively
 *     NOT recycled — you close home after home out of the same basis.
 *
 *   - Optioned: ~4 turns. NVR-style. Land never hits the balance sheet
 *     until takedown, so your capital is dominated by vertical, which
 *     cycles as fast as you can build + sell. This is the number NVR
 *     reports in their community-level economics and is the reason
 *     they earn 30%+ ROIC consistently.
 */
const DEFAULT_CAPITAL_TURNS_PER_YEAR = {
  finished: 3,
  raw: 1,
  optioned: 4,
} as const;

/**
 * Haircut applied to raw gross margin to reconcile with how public
 * homebuilders report homebuilding gross margin. The 5-point haircut
 * covers: sales commissions (~3%), closing costs (~1%), and interest
 * capitalized into cost of sales (~1%). So a raw 21% becomes a
 * reported-equivalent 16%, matching what LEN/DHI/PHM disclose.
 */
const GROSS_MARGIN_HAIRCUT_PCT = 5;

/**
 * Per-bucket corporate SG&A haircut, expressed as a percentage of
 * revenue. Applied on top of the gross-margin number to get the
 * cycle-level estimated ROIC the CEO should expect at the bottom
 * line.
 *
 *   - Optioned 6%: NVR publishes ~7% SG&A / revenue; we shade
 *     slightly below because options shift some overhead onto land
 *     sellers.
 *   - Finished 8%: mid-range public builder (LEN, DHI, PHM) reports
 *     7-9% SG&A / revenue.
 *   - Raw 10%: land-heavy operations carry an entitlement team,
 *     horizontal engineers, and longer overhead stacks; TPH-style
 *     builders report 10-12%.
 *
 * These are defaults; the CEO can stress-test via the slider in the
 * UI, which exposes a single "SG&A multiplier" that scales all three.
 */
const DEFAULT_SGA_PCT_BY_BUCKET = {
  finished: 8,
  raw: 10,
  optioned: 6,
} as const;

/**
 * Annual cost of carry on deployed capital (land + vertical). 8% is
 * the blended cost-of-capital the public builders use in their own
 * community-level underwriting per their 10-K disclosures.
 */
const ANNUAL_CARRY_COST_PCT = 0.08;

/**
 * Projected sale price = median home price × this premium. New
 * construction typically sells at a 5% premium to the median existing-
 * home sale price in the same metro, per NAHB.
 */
const NEW_CONSTRUCTION_PREMIUM = 1.05;

/**
 * Target gross margin assumption for the sale price projection. We
 * don't use this to back into sale price — we use it to flag buckets
 * whose actual computed margin falls below this threshold. Healthy
 * public builders run reported gross margin at 18-24%.
 */
const HEALTHY_MARGIN_THRESHOLD_PCT = 16;

/**
 * QCEW gives us construction sector avg weekly wage. To convert to a
 * per-unit base build cost we anchor to NAHB's 2024 Cost of
 * Constructing a Home survey: $162K average hard cost on a 2,561 sqft
 * median — roughly $63/sqft. We use $70/sqft × 2,500 sqft = $175K as
 * a slightly-forward national baseline for the Phase 3 model.
 *
 * Labor is ~40% of total hard cost per NAHB. So a market whose wage
 * index is 1.3x the national median increases build cost by
 * (0.4 × 0.3) = 12%, NOT 30%. The regional multiplier below
 * implements that labor-share weighting.
 */
const BASE_BUILD_COST_PER_SQFT = 70;
const MEDIAN_HOME_SQFT = 2500;
const NATIONAL_MEDIAN_CONSTRUCTION_WEEKLY_WAGE = 1300;
/** Labor's share of total hard cost per NAHB Cost of Constructing. */
const LABOR_SHARE_OF_BUILD_COST = 0.4;

// ─── Raw inputs shape ─────────────────────────────────────────────

export interface OrganicRawInputs {
  /** Zillow ZHVI — most recent month-start median home value, in dollars. */
  medianHomePrice: {
    value: number | null;
    asOf: string | null;
  };
  /** BLS QCEW — avg weekly wage for construction trades, most recent quarter. */
  constructionAvgWeeklyWage: {
    value: number | null;
    asOf: string | null;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

function computeBaseBuildCost(wageValue: number | null): number {
  const nationalBase = BASE_BUILD_COST_PER_SQFT * MEDIAN_HOME_SQFT;
  if (wageValue === null || !Number.isFinite(wageValue) || wageValue <= 0) {
    return nationalBase;
  }
  // Only the labor share of the base cost scales with the wage
  // differential. The materials share (1 - LABOR_SHARE) stays flat.
  const wageRatio = wageValue / NATIONAL_MEDIAN_CONSTRUCTION_WEEKLY_WAGE;
  const regionalMultiplier =
    (1 - LABOR_SHARE_OF_BUILD_COST) + LABOR_SHARE_OF_BUILD_COST * wageRatio;
  return nationalBase * regionalMultiplier;
}

function computeCarryCost(capital: number, months: number): number {
  const years = months / 12;
  return capital * ANNUAL_CARRY_COST_PCT * years;
}

function weightedAverage(
  buckets: Array<{ weight: number; value: number | null }>
): number | null {
  let totalWeight = 0;
  let totalValue = 0;
  for (const b of buckets) {
    if (b.value === null || !Number.isFinite(b.value)) continue;
    if (b.weight <= 0) continue;
    totalWeight += b.weight;
    totalValue += b.weight * b.value;
  }
  if (totalWeight === 0) return null;
  return totalValue / totalWeight;
}

function roundTo(n: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

// ─── Bucket computations ──────────────────────────────────────────

interface BucketContext {
  rawLandCostPerUnit: number;
  baseBuildCost: number;
  projectedSalePrice: number;
  inputs: BusinessCaseInputs;
}

type BucketKey = "finished" | "raw" | "optioned";

/**
 * Shared bucket post-processing. Given the capital + raw margin for
 * a bucket, applies:
 *
 *   1. The 5-point gross-margin haircut (commissions, closing,
 *      capitalized interest) to get a reported-equivalent margin.
 *   2. The bucket's realistic capital turns per year (NOT 12/months).
 *   3. Cycle contribution = reported margin × turns, PRE-SG&A.
 *   4. Estimated ROIC = cycle contribution − per-bucket SG&A haircut.
 *
 * Returns the three display numbers the bucket output needs, plus
 * the effective SG&A % so the UI can surface it.
 */
function deriveReturnMetrics(
  grossMarginRawPct: number,
  bucket: BucketKey,
  sgaMultiplier: number
): {
  grossMarginPct: number;
  capitalTurnsPerYear: number;
  cycleContributionPct: number;
  estimatedRoicPct: number;
  sgaPct: number;
} {
  const reported = Math.max(
    0,
    grossMarginRawPct - GROSS_MARGIN_HAIRCUT_PCT
  );
  const turns = DEFAULT_CAPITAL_TURNS_PER_YEAR[bucket];
  const cycleContribution = reported * turns;
  // SG&A is a percentage of REVENUE, so to subtract it from a
  // return-on-capital number we multiply it by turns as well (each
  // turn generates a fresh revenue cycle which carries its own SG&A).
  const sgaPct = DEFAULT_SGA_PCT_BY_BUCKET[bucket] * sgaMultiplier;
  const sgaDragPct = sgaPct * turns;
  const estimatedRoic = cycleContribution - sgaDragPct;
  return {
    grossMarginPct: reported,
    capitalTurnsPerYear: turns,
    cycleContributionPct: cycleContribution,
    estimatedRoicPct: estimatedRoic,
    sgaPct,
  };
}

function computeFinishedBucket(
  ctx: BucketContext,
  mixPct: number
): OrganicBucketOutput {
  if (mixPct <= 0) {
    return emptyBucket(mixPct, ["Bucket disabled — 0% allocation."]);
  }
  const lotCost = ctx.rawLandCostPerUnit * (1 + FINISHED_LOT_PREMIUM_PCT);
  const buildCost = ctx.baseBuildCost * ctx.inputs.buildCostMultiplier;
  const preCarryCapital = lotCost + buildCost;
  const carry = computeCarryCost(preCarryCapital, MONTHS_TO_FIRST_CLOSING.finished);
  const capitalPerUnit = preCarryCapital + carry;
  const grossMarginDollars = ctx.projectedSalePrice - capitalPerUnit;
  const grossMarginRawPct = (grossMarginDollars / ctx.projectedSalePrice) * 100;
  const metrics = deriveReturnMetrics(
    grossMarginRawPct,
    "finished",
    ctx.inputs.sgaMultiplier
  );

  const notes: string[] = [];
  notes.push("Finished lots — ready for vertical immediately, ~3 turns/yr.");
  if (metrics.grossMarginPct < HEALTHY_MARGIN_THRESHOLD_PCT) {
    notes.push(
      `Reported margin ${roundTo(metrics.grossMarginPct, 1)}% below ${HEALTHY_MARGIN_THRESHOLD_PCT}% threshold — finished-lot premium is eating margin.`
    );
  }
  return {
    mixPct,
    capitalPerUnit: Math.round(capitalPerUnit),
    monthsToFirstClosing: MONTHS_TO_FIRST_CLOSING.finished,
    grossMarginPct: roundTo(metrics.grossMarginPct, 1),
    capitalTurnsPerYear: metrics.capitalTurnsPerYear,
    cycleContributionPct: roundTo(metrics.cycleContributionPct, 1),
    estimatedRoicPct: roundTo(metrics.estimatedRoicPct, 1),
    sgaPct: roundTo(metrics.sgaPct, 1),
    notes,
  };
}

function computeRawBucket(
  ctx: BucketContext,
  mixPct: number
): OrganicBucketOutput {
  if (mixPct <= 0) {
    return emptyBucket(mixPct, ["Bucket disabled — 0% allocation."]);
  }
  const horizontalCost =
    ctx.rawLandCostPerUnit * (ctx.inputs.horizontalPctOfRaw / 100);
  const buildCost = ctx.baseBuildCost * ctx.inputs.buildCostMultiplier;
  const preCarryCapital = ctx.rawLandCostPerUnit + horizontalCost + buildCost;
  const carry = computeCarryCost(preCarryCapital, MONTHS_TO_FIRST_CLOSING.raw);
  const capitalPerUnit = preCarryCapital + carry;
  const grossMarginDollars = ctx.projectedSalePrice - capitalPerUnit;
  const grossMarginRawPct = (grossMarginDollars / ctx.projectedSalePrice) * 100;
  const metrics = deriveReturnMetrics(
    grossMarginRawPct,
    "raw",
    ctx.inputs.sgaMultiplier
  );

  const notes: string[] = [];
  notes.push(
    "Raw land — cheapest basis, longest hold; ~1 turn/yr because land carries the community."
  );
  if (metrics.grossMarginPct >= HEALTHY_MARGIN_THRESHOLD_PCT) {
    notes.push(
      `Strongest reported margin at ${roundTo(metrics.grossMarginPct, 1)}% — rewards a CEO who can carry the horizontal work.`
    );
  }
  return {
    mixPct,
    capitalPerUnit: Math.round(capitalPerUnit),
    monthsToFirstClosing: MONTHS_TO_FIRST_CLOSING.raw,
    grossMarginPct: roundTo(metrics.grossMarginPct, 1),
    capitalTurnsPerYear: metrics.capitalTurnsPerYear,
    cycleContributionPct: roundTo(metrics.cycleContributionPct, 1),
    estimatedRoicPct: roundTo(metrics.estimatedRoicPct, 1),
    sgaPct: roundTo(metrics.sgaPct, 1),
    notes,
  };
}

function computeOptionedBucket(
  ctx: BucketContext,
  mixPct: number
): OrganicBucketOutput {
  if (mixPct <= 0) {
    return emptyBucket(mixPct, ["Bucket disabled — 0% allocation."]);
  }
  // At pull, you pay the full land cost plus the option fee. Upfront
  // capital is just the fee — but per-unit capital at closing is land
  // + fee + build (someone else carried the land until pull).
  const optionFee = ctx.rawLandCostPerUnit * (ctx.inputs.optionFeePct / 100);
  const buildCost = ctx.baseBuildCost * ctx.inputs.buildCostMultiplier;
  const preCarryCapital = ctx.rawLandCostPerUnit + optionFee + buildCost;
  const carry = computeCarryCost(buildCost, MONTHS_TO_FIRST_CLOSING.optioned);
  const capitalPerUnit = preCarryCapital + carry;
  const grossMarginDollars = ctx.projectedSalePrice - capitalPerUnit;
  const grossMarginRawPct = (grossMarginDollars / ctx.projectedSalePrice) * 100;
  const metrics = deriveReturnMetrics(
    grossMarginRawPct,
    "optioned",
    ctx.inputs.sgaMultiplier
  );

  const notes: string[] = [];
  notes.push(
    "Optioned — NVR-style. Capital cycles as fast as vertical; ~4 turns/yr."
  );
  if (metrics.estimatedRoicPct >= 25) {
    notes.push(
      `Estimated ROIC ${roundTo(metrics.estimatedRoicPct, 0)}% — option premium is earning its keep.`
    );
  }
  return {
    mixPct,
    capitalPerUnit: Math.round(capitalPerUnit),
    monthsToFirstClosing: MONTHS_TO_FIRST_CLOSING.optioned,
    grossMarginPct: roundTo(metrics.grossMarginPct, 1),
    capitalTurnsPerYear: metrics.capitalTurnsPerYear,
    cycleContributionPct: roundTo(metrics.cycleContributionPct, 1),
    estimatedRoicPct: roundTo(metrics.estimatedRoicPct, 1),
    sgaPct: roundTo(metrics.sgaPct, 1),
    notes,
  };
}

function emptyBucket(mixPct: number, notes: string[]): OrganicBucketOutput {
  return {
    mixPct,
    capitalPerUnit: null,
    monthsToFirstClosing: null,
    grossMarginPct: null,
    capitalTurnsPerYear: null,
    cycleContributionPct: null,
    estimatedRoicPct: null,
    sgaPct: 0,
    notes,
  };
}

// ─── Public entrypoint ────────────────────────────────────────────

export function computeOrganicEntry(
  raw: OrganicRawInputs,
  inputs: BusinessCaseInputs
): OrganicOutput {
  const warnings: string[] = [];

  // Validate mix sums to ~100
  const mixSum =
    inputs.landMix.pctFinished +
    inputs.landMix.pctRaw +
    inputs.landMix.pctOptioned;
  if (Math.abs(mixSum - 100) > 0.5) {
    warnings.push(
      `Portfolio mix sums to ${mixSum}% instead of 100%. Results are scaled accordingly.`
    );
  }

  const medianPrice = raw.medianHomePrice.value;
  if (medianPrice === null || medianPrice <= 0) {
    warnings.push(
      "No median home price available for this market (Zillow ZHVI not covering). Model cannot compute capital or margin."
    );
    return emptyOrganicOutput(inputs, warnings, raw);
  }

  const rawLandCostPerUnit = medianPrice * (inputs.landSharePct / 100);
  const baseBuildCost = computeBaseBuildCost(raw.constructionAvgWeeklyWage.value);
  const projectedSalePrice = medianPrice * NEW_CONSTRUCTION_PREMIUM;

  if (raw.constructionAvgWeeklyWage.value === null) {
    warnings.push(
      "QCEW construction wage unavailable for this market. Base build cost reverts to the national default."
    );
  }

  const ctx: BucketContext = {
    rawLandCostPerUnit,
    baseBuildCost,
    projectedSalePrice,
    inputs,
  };

  const finished = computeFinishedBucket(ctx, inputs.landMix.pctFinished);
  const rawBucket = computeRawBucket(ctx, inputs.landMix.pctRaw);
  const optioned = computeOptionedBucket(ctx, inputs.landMix.pctOptioned);

  const blendedCapitalPerUnit = weightedAverage([
    { weight: finished.mixPct, value: finished.capitalPerUnit },
    { weight: rawBucket.mixPct, value: rawBucket.capitalPerUnit },
    { weight: optioned.mixPct, value: optioned.capitalPerUnit },
  ]);

  const blendedMonthsToFirstClosing = weightedAverage([
    { weight: finished.mixPct, value: finished.monthsToFirstClosing },
    { weight: rawBucket.mixPct, value: rawBucket.monthsToFirstClosing },
    { weight: optioned.mixPct, value: optioned.monthsToFirstClosing },
  ]);

  const blendedGrossMarginPct = weightedAverage([
    { weight: finished.mixPct, value: finished.grossMarginPct },
    { weight: rawBucket.mixPct, value: rawBucket.grossMarginPct },
    { weight: optioned.mixPct, value: optioned.grossMarginPct },
  ]);

  const blendedCapitalTurnsPerYear = weightedAverage([
    { weight: finished.mixPct, value: finished.capitalTurnsPerYear },
    { weight: rawBucket.mixPct, value: rawBucket.capitalTurnsPerYear },
    { weight: optioned.mixPct, value: optioned.capitalTurnsPerYear },
  ]);

  const blendedCycleContributionPct = weightedAverage([
    { weight: finished.mixPct, value: finished.cycleContributionPct },
    { weight: rawBucket.mixPct, value: rawBucket.cycleContributionPct },
    { weight: optioned.mixPct, value: optioned.cycleContributionPct },
  ]);

  const blendedEstimatedRoicPct = weightedAverage([
    { weight: finished.mixPct, value: finished.estimatedRoicPct },
    { weight: rawBucket.mixPct, value: rawBucket.estimatedRoicPct },
    { weight: optioned.mixPct, value: optioned.estimatedRoicPct },
  ]);

  // Year-one capital deployed = blended capital × target unit volume ×
  // absorption multiplier. Absorption < 1 stretches the year-one deploy
  // because fewer units are reached.
  let yearOneCapitalDeployed: number | null = null;
  if (blendedCapitalPerUnit !== null) {
    const effectiveUnits =
      inputs.targetUnitsPerYear * inputs.absorptionMultiplier;
    yearOneCapitalDeployed = Math.round(
      blendedCapitalPerUnit * effectiveUnits
    );
  }

  if (
    blendedGrossMarginPct !== null &&
    blendedGrossMarginPct < HEALTHY_MARGIN_THRESHOLD_PCT
  ) {
    warnings.push(
      `Blended gross margin ${roundTo(blendedGrossMarginPct, 1)}% is below the ${HEALTHY_MARGIN_THRESHOLD_PCT}% healthy threshold. Consider a higher optioned allocation or a market with a better land-share profile.`
    );
  }

  return {
    blendedCapitalPerUnit:
      blendedCapitalPerUnit !== null
        ? Math.round(blendedCapitalPerUnit)
        : null,
    blendedMonthsToFirstClosing:
      blendedMonthsToFirstClosing !== null
        ? roundTo(blendedMonthsToFirstClosing, 1)
        : null,
    blendedGrossMarginPct:
      blendedGrossMarginPct !== null
        ? roundTo(blendedGrossMarginPct, 1)
        : null,
    blendedCapitalTurnsPerYear:
      blendedCapitalTurnsPerYear !== null
        ? roundTo(blendedCapitalTurnsPerYear, 2)
        : null,
    blendedCycleContributionPct:
      blendedCycleContributionPct !== null
        ? roundTo(blendedCycleContributionPct, 1)
        : null,
    blendedEstimatedRoicPct:
      blendedEstimatedRoicPct !== null
        ? roundTo(blendedEstimatedRoicPct, 1)
        : null,
    yearOneCapitalDeployed,
    finished,
    raw: rawBucket,
    optioned,
    assumptions: {
      medianHomePrice: Math.round(medianPrice),
      medianHomePriceAsOf: raw.medianHomePrice.asOf,
      landCostPerUnit: Math.round(rawLandCostPerUnit),
      finishedLotPremium: FINISHED_LOT_PREMIUM_PCT * 100,
      baseBuildCost: Math.round(baseBuildCost),
      carryingCostPerUnit: Math.round(
        computeCarryCost(rawLandCostPerUnit + baseBuildCost, 12)
      ),
      projectedSalePrice: Math.round(projectedSalePrice),
    },
    warnings,
  };
}

function emptyOrganicOutput(
  inputs: BusinessCaseInputs,
  warnings: string[],
  raw: OrganicRawInputs
): OrganicOutput {
  return {
    blendedCapitalPerUnit: null,
    blendedMonthsToFirstClosing: null,
    blendedGrossMarginPct: null,
    blendedCapitalTurnsPerYear: null,
    blendedCycleContributionPct: null,
    blendedEstimatedRoicPct: null,
    yearOneCapitalDeployed: null,
    finished: emptyBucket(inputs.landMix.pctFinished, ["No data."]),
    raw: emptyBucket(inputs.landMix.pctRaw, ["No data."]),
    optioned: emptyBucket(inputs.landMix.pctOptioned, ["No data."]),
    assumptions: {
      medianHomePrice: null,
      medianHomePriceAsOf: raw.medianHomePrice.asOf,
      landCostPerUnit: null,
      finishedLotPremium: FINISHED_LOT_PREMIUM_PCT * 100,
      baseBuildCost: null,
      carryingCostPerUnit: null,
      projectedSalePrice: null,
    },
    warnings,
  };
}
