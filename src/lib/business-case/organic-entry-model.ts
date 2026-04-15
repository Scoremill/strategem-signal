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
import {
  classifyMarketTier,
  type BusinessCaseInputs,
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
 * Capital turns per year, per bucket. NOT 12 / months-to-first-closing
 * — that would be an annualization trick. Real community-level turns
 * depend on how long capital stays locked into the LAND portion of
 * the basis, with friction between cycles that prevents the idealized
 * 12/months number:
 *
 *   - Finished lots: ~2.5 turns. Vertical cycle is ~4 months but you
 *     can't redeploy that dollar instantly — there's 1-2 months of
 *     permit/sales friction between each cycle and builders typically
 *     don't run 100% utilization on their land position.
 *
 *   - Raw land: ~1 turn. Land sits on the balance sheet through the
 *     full development + absorption arc of a community (~3-4 years
 *     for a 150-unit community at 40 closings/yr). Capital is
 *     effectively NOT recycled — you close home after home out of
 *     the same basis.
 *
 *   - Optioned: ~3 turns. NVR-style. Land never hits the balance
 *     sheet until takedown, so your capital is dominated by vertical,
 *     which cycles fast. NVR's actual reported turns at the business
 *     level are ~2-2.5x, so 3 is a slightly generous bucket-level
 *     assumption that the slider lets the CEO pull down if their
 *     model is tighter.
 */
const DEFAULT_CAPITAL_TURNS_PER_YEAR = {
  finished: 2.5,
  raw: 1,
  optioned: 3,
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
 * Target gross margin assumption for the sale price projection. We
 * don't use this to back into sale price — we use it to flag buckets
 * whose actual computed margin falls below this threshold. Healthy
 * public builders run reported gross margin at 18-24%.
 */
const HEALTHY_MARGIN_THRESHOLD_PCT = 16;

/**
 * National median construction wage used for the regional wage
 * multiplier. Wages above this pull build cost up; wages below pull
 * it down. Labor is ~40% of total hard cost per NAHB Cost of
 * Constructing, so the wage adjustment is scaled by that share.
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
  // Only the labor share of the base cost scales with the wage
  // differential. The materials share (1 - LABOR_SHARE) stays flat.
  const wageRatio = wageValue / NATIONAL_MEDIAN_CONSTRUCTION_WEEKLY_WAGE;
  const rawMultiplier =
    (1 - LABOR_SHARE_OF_BUILD_COST) + LABOR_SHARE_OF_BUILD_COST * wageRatio;
  // Floor at 0.95. Wages below the national median don't cut build
  // cost proportionally — materials are roughly national, haul
  // distances are longer in cheap markets, and small trade pools
  // push up costs. Cap at 1.25 on the upside: a 2x wage index in a
  // coastal metro doesn't double build cost, it compresses at the
  // top end as builders substitute less-labor-intensive methods.
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
  // Apply the 5-point haircut for commissions, closing, capitalized
  // interest. DO NOT clamp to zero — a negative margin is a real
  // signal that the market doesn't support vertical construction at
  // the current inputs, and hiding it would mislead the CEO. No one
  // enters a market with long-term negative margins, so the honest
  // read has to flow through.
  const reported = grossMarginRawPct - GROSS_MARGIN_HAIRCUT_PCT;
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

  // Classify the market tier from the median home price. The tier
  // drives sqft, base build cost, and the new-construction premium —
  // all of which vary materially by metro size/cost (Phase 3.10).
  const tierDefaults = classifyMarketTier(medianPrice);

  const rawLandCostPerUnit = medianPrice * (inputs.landSharePct / 100);
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
    tier: tierDefaults.tier,
    tierLabel: tierDefaults.label,
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
  return {
    tier: fallbackTier.tier,
    tierLabel: fallbackTier.label,
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
