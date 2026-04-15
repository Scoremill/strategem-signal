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
 * whose actual computed margin falls below this threshold.
 */
const HEALTHY_MARGIN_THRESHOLD_PCT = 18;

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
  const grossMargin = ctx.projectedSalePrice - capitalPerUnit;
  const grossMarginPct = (grossMargin / ctx.projectedSalePrice) * 100;
  const roicPct = (grossMargin / capitalPerUnit) * (12 / MONTHS_TO_FIRST_CLOSING.finished) * 100;

  const notes: string[] = [];
  notes.push("Finished lots — ready for vertical immediately.");
  if (grossMarginPct < HEALTHY_MARGIN_THRESHOLD_PCT) {
    notes.push(
      `Margin ${roundTo(grossMarginPct, 1)}% below ${HEALTHY_MARGIN_THRESHOLD_PCT}% threshold — finished-lot premium may be eating margin.`
    );
  }
  return {
    mixPct,
    capitalPerUnit: Math.round(capitalPerUnit),
    monthsToFirstClosing: MONTHS_TO_FIRST_CLOSING.finished,
    grossMarginPct: roundTo(grossMarginPct, 1),
    roicPct: roundTo(roicPct, 1),
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
  const grossMargin = ctx.projectedSalePrice - capitalPerUnit;
  const grossMarginPct = (grossMargin / ctx.projectedSalePrice) * 100;
  const roicPct = (grossMargin / capitalPerUnit) * (12 / MONTHS_TO_FIRST_CLOSING.raw) * 100;

  const notes: string[] = [];
  notes.push("Raw land — cheapest basis but 18-36mo before first closing.");
  if (grossMarginPct >= HEALTHY_MARGIN_THRESHOLD_PCT) {
    notes.push(
      `Strongest margin at ${roundTo(grossMarginPct, 1)}% — rewards the CEO who can carry the horizontal work.`
    );
  }
  return {
    mixPct,
    capitalPerUnit: Math.round(capitalPerUnit),
    monthsToFirstClosing: MONTHS_TO_FIRST_CLOSING.raw,
    grossMarginPct: roundTo(grossMarginPct, 1),
    roicPct: roundTo(roicPct, 1),
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
  const grossMargin = ctx.projectedSalePrice - capitalPerUnit;
  const grossMarginPct = (grossMargin / ctx.projectedSalePrice) * 100;
  const roicPct = (grossMargin / capitalPerUnit) * (12 / MONTHS_TO_FIRST_CLOSING.optioned) * 100;

  const notes: string[] = [];
  notes.push("Optioned — NVR-style. Minimal upfront capital, highest ROIC.");
  if (roicPct >= 40) {
    notes.push(`ROIC ${roundTo(roicPct, 0)}% — option premium is earning its keep.`);
  }
  return {
    mixPct,
    capitalPerUnit: Math.round(capitalPerUnit),
    monthsToFirstClosing: MONTHS_TO_FIRST_CLOSING.optioned,
    grossMarginPct: roundTo(grossMarginPct, 1),
    roicPct: roundTo(roicPct, 1),
    notes,
  };
}

function emptyBucket(mixPct: number, notes: string[]): OrganicBucketOutput {
  return {
    mixPct,
    capitalPerUnit: null,
    monthsToFirstClosing: null,
    grossMarginPct: null,
    roicPct: null,
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

  const blendedRoicPct = weightedAverage([
    { weight: finished.mixPct, value: finished.roicPct },
    { weight: rawBucket.mixPct, value: rawBucket.roicPct },
    { weight: optioned.mixPct, value: optioned.roicPct },
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
    blendedRoicPct:
      blendedRoicPct !== null ? roundTo(blendedRoicPct, 1) : null,
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
    blendedRoicPct: null,
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
