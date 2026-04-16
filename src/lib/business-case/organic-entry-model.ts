/**
 * Organic Entry Model — pure scorer.
 *
 * Given a market's median home price (Zillow ZHVI), construction labor
 * cost (QCEW avg weekly wage for NAICS 2382/2383), and a set of CEO
 * inputs (land cost share, portfolio mix, absorption, operational
 * execution), compute per-unit capital, time-to-closing, gross margin,
 * turns, cycle contribution, and estimated ROIC for each of three
 * land-flavor buckets plus a portfolio-weighted rollup.
 *
 * Design decisions (Phase 3.2 onward):
 *
 *   1. Three-bucket portfolio blend. Real builders mix finished lots,
 *      raw land, and optioned land.
 *
 *   2. Tier-aware defaults. Median price classifies the market into
 *      one of four tiers (A-D), which drives sqft, land cost share,
 *      base build cost, and new-construction premium.
 *
 *   3. ONE operational-execution control instead of separate turns,
 *      SG&A, and build-cost sliders. The CEO picks Average / Strong /
 *      Best-in-class and the model moves all three together to a
 *      coherent profile. Prevents fantasy combinations.
 *
 *   4. Finished lots carry a 20% premium over raw land cost (NAHB
 *      published comps). Raw land bucket adds a horizontal cost line.
 *      Optioned bucket pays the option fee upfront and only the
 *      takedown at pull.
 *
 *   5. Carry costs at 8% annual on deployed capital.
 *      Months-to-first-closing per bucket: finished 4, raw 24, optioned 6.
 *
 *   6. Pure function, no DB imports. Pipeline reads Zillow + QCEW and
 *      passes them in as OrganicRawInputs.
 */
import {
  classifyMarketTier,
  EXECUTION_PROFILES,
  type BusinessCaseInputs,
  type OperationalExecutionProfile,
  type OrganicBucketOutput,
  type OrganicOutput,
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
 * Haircut applied to raw gross margin to reconcile with how public
 * homebuilders report homebuilding gross margin. The 5-point haircut
 * covers: sales commissions (~3%), closing costs (~1%), and interest
 * capitalized into cost of sales (~1%). So a raw 21% becomes a
 * reported-equivalent 16%, matching what LEN/DHI/PHM disclose.
 */
const GROSS_MARGIN_HAIRCUT_PCT = 5;

/**
 * Per-bucket corporate SG&A haircut, expressed as a percentage of
 * revenue — AT AVERAGE EXECUTION. The OperationalExecutionProfile
 * scales these up or down as part of the posture choice.
 *
 *   - Optioned 6%: NVR publishes ~7% SG&A / revenue; we shade
 *     slightly below because options shift some overhead onto land
 *     sellers.
 *   - Finished 8%: mid-range public builder (LEN, DHI, PHM) reports
 *     7-9% SG&A / revenue.
 *   - Raw 10%: land-heavy operations carry an entitlement team,
 *     horizontal engineers, and longer overhead stacks.
 */
const BASELINE_SGA_PCT_BY_BUCKET = {
  finished: 8,
  raw: 10,
  optioned: 6,
} as const;

/**
 * Annual cost of carry on deployed capital. 8% is the blended cost-
 * of-capital the public builders use in their own community-level
 * underwriting per their 10-K disclosures.
 */
const ANNUAL_CARRY_COST_PCT = 0.08;

/**
 * Threshold for flagging a bucket as "below healthy" on reported
 * gross margin. Healthy public builders run 18-24%; 16% is the
 * floor for "defensible."
 */
const HEALTHY_MARGIN_THRESHOLD_PCT = 16;

/**
 * National median construction wage used for the regional wage
 * multiplier. Wages above this pull build cost up; wages below
 * pull it down. Labor is ~40% of total hard cost per NAHB Cost
 * of Constructing.
 */
const NATIONAL_MEDIAN_CONSTRUCTION_WEEKLY_WAGE = 1300;
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

function computeBaseBuildCost(
  wageValue: number | null,
  sqft: number,
  baseRatePerSqft: number
): number {
  const tierBase = baseRatePerSqft * sqft;
  if (wageValue === null || !Number.isFinite(wageValue) || wageValue <= 0) {
    return tierBase;
  }
  const wageRatio = wageValue / NATIONAL_MEDIAN_CONSTRUCTION_WEEKLY_WAGE;
  const rawMultiplier =
    (1 - LABOR_SHARE_OF_BUILD_COST) + LABOR_SHARE_OF_BUILD_COST * wageRatio;
  // Floor at 0.95, cap at 1.25 — materials are ~national and top-tier
  // wage metros substitute less-labor-intensive methods.
  const regionalMultiplier = Math.max(0.95, Math.min(1.25, rawMultiplier));
  return tierBase * regionalMultiplier;
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
  execution: OperationalExecutionProfile;
}

type BucketKey = "finished" | "raw" | "optioned";

/**
 * Shared bucket post-processing. Applies the margin haircut, turns
 * from the execution profile, cycle contribution, and SG&A drag.
 */
function deriveReturnMetrics(
  grossMarginRawPct: number,
  bucket: BucketKey,
  execution: OperationalExecutionProfile
): {
  grossMarginPct: number;
  capitalTurnsPerYear: number;
  cycleContributionPct: number;
  estimatedRoicPct: number;
  sgaPct: number;
} {
  // 5-point haircut for commissions, closing, capitalized interest.
  // NO clamp — honest negative numbers are a real signal.
  const reported = grossMarginRawPct - GROSS_MARGIN_HAIRCUT_PCT;
  const turns = execution.turnsByBucket[bucket];
  const cycleContribution = reported * turns;
  const sgaPct = BASELINE_SGA_PCT_BY_BUCKET[bucket] * execution.sgaMultiplier;
  // SG&A is a % of revenue, so to subtract from a return-on-capital
  // number we scale by turns (each turn carries its own SG&A cycle).
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
  const buildCost = ctx.baseBuildCost * ctx.execution.buildCostMultiplier;
  const preCarryCapital = lotCost + buildCost;
  const carry = computeCarryCost(preCarryCapital, MONTHS_TO_FIRST_CLOSING.finished);
  const capitalPerUnit = preCarryCapital + carry;
  const grossMarginDollars = ctx.projectedSalePrice - capitalPerUnit;
  const grossMarginRawPct = (grossMarginDollars / ctx.projectedSalePrice) * 100;
  const metrics = deriveReturnMetrics(
    grossMarginRawPct,
    "finished",
    ctx.execution
  );

  const notes: string[] = [];
  notes.push(
    `Finished lots — ready for vertical immediately, ~${metrics.capitalTurnsPerYear} turns/yr at ${ctx.execution.label.toLowerCase()} execution.`
  );
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
  const buildCost = ctx.baseBuildCost * ctx.execution.buildCostMultiplier;
  const preCarryCapital = ctx.rawLandCostPerUnit + horizontalCost + buildCost;
  const carry = computeCarryCost(preCarryCapital, MONTHS_TO_FIRST_CLOSING.raw);
  const capitalPerUnit = preCarryCapital + carry;
  const grossMarginDollars = ctx.projectedSalePrice - capitalPerUnit;
  const grossMarginRawPct = (grossMarginDollars / ctx.projectedSalePrice) * 100;
  const metrics = deriveReturnMetrics(grossMarginRawPct, "raw", ctx.execution);

  const notes: string[] = [];
  notes.push(
    `Raw land — cheapest basis, longest hold; ~${metrics.capitalTurnsPerYear} turn/yr because land carries the community.`
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
  const optionFee = ctx.rawLandCostPerUnit * (ctx.inputs.optionFeePct / 100);
  const buildCost = ctx.baseBuildCost * ctx.execution.buildCostMultiplier;
  const preCarryCapital = ctx.rawLandCostPerUnit + optionFee + buildCost;
  const carry = computeCarryCost(buildCost, MONTHS_TO_FIRST_CLOSING.optioned);
  const capitalPerUnit = preCarryCapital + carry;
  const grossMarginDollars = ctx.projectedSalePrice - capitalPerUnit;
  const grossMarginRawPct = (grossMarginDollars / ctx.projectedSalePrice) * 100;
  const metrics = deriveReturnMetrics(
    grossMarginRawPct,
    "optioned",
    ctx.execution
  );

  const notes: string[] = [];
  notes.push(
    `Optioned — NVR-style. Capital cycles as fast as vertical; ~${metrics.capitalTurnsPerYear} turns/yr at ${ctx.execution.label.toLowerCase()} execution.`
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
  const execution = EXECUTION_PROFILES[inputs.operationalExecution];

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

  const tierDefaults = classifyMarketTier(medianPrice);

  const rawLandCostPerUnit = medianPrice * (inputs.landCostSharePct / 100);
  const baseBuildCost = computeBaseBuildCost(
    raw.constructionAvgWeeklyWage.value,
    tierDefaults.medianHomeSqft,
    tierDefaults.baseBuildCostPerSqft
  );
  const projectedSalePrice = medianPrice * tierDefaults.newConstructionPremium;

  if (raw.constructionAvgWeeklyWage.value === null) {
    warnings.push(
      "QCEW construction wage unavailable for this market. Base build cost reverts to the tier default."
    );
  }

  const ctx: BucketContext = {
    rawLandCostPerUnit,
    baseBuildCost,
    projectedSalePrice,
    inputs,
    execution,
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
      `Blended gross margin ${roundTo(blendedGrossMarginPct, 1)}% is below the ${HEALTHY_MARGIN_THRESHOLD_PCT}% healthy threshold. Consider a higher optioned allocation or a market with a better land-cost-share profile.`
    );
  }

  return {
    tier: tierDefaults.tier,
    tierLabel: tierDefaults.label,
    execution: execution.key,
    executionLabel: execution.label,
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
      medianHomeSqft: tierDefaults.medianHomeSqft,
      baseBuildCostPerSqft: tierDefaults.baseBuildCostPerSqft,
      newConstructionPremium: tierDefaults.newConstructionPremium,
    },
    warnings,
  };
}

function emptyOrganicOutput(
  inputs: BusinessCaseInputs,
  warnings: string[],
  raw: OrganicRawInputs
): OrganicOutput {
  const fallbackTier = classifyMarketTier(null);
  const execution = EXECUTION_PROFILES[inputs.operationalExecution];
  return {
    tier: fallbackTier.tier,
    tierLabel: fallbackTier.label,
    execution: execution.key,
    executionLabel: execution.label,
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
      medianHomeSqft: null,
      baseBuildCostPerSqft: null,
      newConstructionPremium: null,
    },
    warnings,
  };
}
