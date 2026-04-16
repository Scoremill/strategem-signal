/**
 * Portfolio Health scoring — external signals only.
 *
 * Pure functions. No database imports. The pipeline fetches the raw
 * inputs and calls computePortfolioHealth(); the scorer only does math
 * and source-trace construction. This isolation makes the scoring logic
 * trivially testable and keeps the per-market math reviewable in one file.
 *
 * Design notes (Phase 1.2 locked decisions — do not rework without
 * re-consulting Drew):
 *
 *   1. External data only. No StrategemOps internal metrics. Company-
 *      level averages as a proxy for market financials are explicitly
 *      out of scope — Drew decided this during Phase 0.
 *
 *   2. Three sub-scores, each 0-100:
 *        - Financial:     affordability runway (income + wage growth)
 *        - Demand:        permits YoY + employment growth + migration
 *                         + unemployment (inverted)
 *        - Operational:   QCEW construction wages + trade employment
 *                         trajectory (not OES — OES only covers 7 of
 *                         52 markets, QCEW covers all 52)
 *
 *   3. Composite at default 40/30/30 (Financial/Demand/Operational).
 *      The snapshot stores the composite at default weights so the
 *      heatmap loads instantly; per-user slider in Phase 1.3 re-blends
 *      the three stored sub-scores on the client.
 *
 *   4. Every numeric input is clamped to [0, 100] at the sub-score level
 *      so a single outlier (e.g. a 300% permits spike in a tiny metro)
 *      can't distort the whole composite.
 *
 *   5. Every input carries a { source, asOf, value } tuple in
 *      inputsJson so the drilldown "View Sources" modal (Phase 1.6)
 *      can show exact provenance per the CEO traceability requirement.
 *
 * Missing-data policy: if an input is null/missing, the sub-score
 * that uses it is computed from whatever inputs ARE available with
 * renormalized weights. A sub-score becomes null only when all of
 * its inputs are missing — that's a signal, not a silent zero.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface SourceTrace {
  value: number | null;
  source: string; // e.g. "census_permits", "bls_laus"
  asOf: string; // ISO date string or YYYY year
}

export interface RawInputs {
  /** Census Building Permits: total single-family permits YoY % change */
  permitsYoyPct: SourceTrace;
  /** BLS CES total nonfarm employment YoY % change */
  employmentYoyPct: SourceTrace;
  /** BLS LAUS unemployment rate (%, not inverted — scorer inverts) */
  unemploymentRate: SourceTrace;
  /** Census PEP annual population change % */
  populationChangePct: SourceTrace;
  /** Census PEP net domestic migration (absolute count, for context) */
  netDomesticMigration: SourceTrace;
  /** Census ACS median household income (dollars, for affordability) */
  medianHouseholdIncome: SourceTrace;
  /** Census ACS median household income YoY % change */
  incomeYoyPct: SourceTrace;
  /** BLS QCEW construction wages YoY % change (weighted average across NAICS) */
  qcewWageYoyPct: SourceTrace;
  /** BLS QCEW construction employment YoY % change (weighted avg) */
  qcewEmploymentYoyPct: SourceTrace;
}

export interface SubScore {
  score: number | null; // 0-100, null if all inputs missing
  inputsUsed: number;
  inputsMissing: number;
}

export interface PortfolioHealthResult {
  financial: SubScore;
  demand: SubScore;
  operational: SubScore;
  composite: number | null;
  inputs: RawInputs;
}

// ─── Score normalizers ──────────────────────────────────────────

/**
 * Clamp a raw value to [0, 100] using a linear mapping from [min, max].
 * Values below min become 0; values above max become 100.
 *
 * The [min, max] windows below are chosen to reflect real-world
 * variation across the 52 MSAs we track, NOT the theoretical min/max
 * of the input. That way a "healthy" market sits near the middle of
 * the scale, not pinned to 100.
 */
function normalize(value: number | null, min: number, max: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (max === min) return 50;
  const clamped = Math.max(min, Math.min(max, value));
  return ((clamped - min) / (max - min)) * 100;
}

/**
 * Inverse-normalize: higher raw = lower score. Used for unemployment
 * where a lower rate is better.
 */
function normalizeInverse(
  value: number | null,
  min: number,
  max: number
): number | null {
  const n = normalize(value, min, max);
  return n == null ? null : 100 - n;
}

/**
 * Weighted average of [score, weight] tuples, skipping nulls and
 * renormalizing the remaining weights so a missing input doesn't
 * deflate the sub-score.
 *
 * Minimum-inputs guard: if the sub-score has more than `minRequired`
 * total inputs but fewer than `minRequired` are present, the sub-score
 * is null rather than computed from a single surviving signal. This
 * prevents a sparse market from ranking #1 on the strength of one
 * low unemployment rate. A market with null sub-scores simply drops
 * to the bottom of its row in the ranking table and renormalizes in
 * the composite — the user sees "insufficient data" rather than a
 * silently wrong number.
 */
function weightedAverage(
  inputs: Array<[number | null, number]>,
  minRequired = 2
): { score: number | null; used: number; missing: number } {
  let weightSum = 0;
  let scoreSum = 0;
  let used = 0;
  let missing = 0;
  for (const [score, weight] of inputs) {
    if (score == null) {
      missing++;
      continue;
    }
    weightSum += weight;
    scoreSum += score * weight;
    used++;
  }
  if (weightSum === 0) return { score: null, used, missing };
  // If the sub-score has a meaningful number of inputs but too few are
  // present, refuse to compute. We allow single-input sub-scores when
  // the sub-score is only designed with 1 or 2 inputs total (e.g. an
  // old financial blend before we add more sources).
  const totalInputs = used + missing;
  if (totalInputs >= 3 && used < minRequired) {
    return { score: null, used, missing };
  }
  return { score: scoreSum / weightSum, used, missing };
}

// ─── Sub-score computers ────────────────────────────────────────

/**
 * Financial sub-score — affordability runway.
 *
 * Two inputs today; can grow without changing the shape:
 *   - Median household income YoY growth (wages rising)
 *     normalized on [0%, 8%] — 8% YoY is the top decile across
 *     US metros historically, and 0% is where affordability starts
 *     to erode against inflation.
 *   - Absolute median household income level (higher = more runway)
 *     normalized on [$55k, $120k] — covers the 52 MSA range.
 *
 * Weighted 60% on the YoY trajectory, 40% on the absolute level.
 * The trajectory matters more because a high-income metro with
 * falling real wages has less runway than a mid-income metro
 * where wages are climbing.
 */
function scoreFinancial(inputs: RawInputs): SubScore {
  const trajectoryScore = normalize(inputs.incomeYoyPct.value, 0, 8);
  const levelScore = normalize(inputs.medianHouseholdIncome.value, 55_000, 120_000);
  const w = weightedAverage([
    [trajectoryScore, 0.6],
    [levelScore, 0.4],
  ]);
  return { score: w.score, inputsUsed: w.used, inputsMissing: w.missing };
}

/**
 * Demand sub-score — is this market growing?
 *
 * Four inputs:
 *   - Single-family permits YoY % change, [-30%, +30%]
 *   - Total nonfarm employment YoY % change, [-2%, +5%]
 *   - Population change % (annual), [-1%, +3%]
 *   - Unemployment rate, inverted on [3%, 8%] (lower is better)
 *
 * Weighted: permits 30, employment 25, population 25, unemployment 20.
 * Permits lead because homebuilder demand IS the point of the product;
 * unemployment is defensive (it's a leading negative).
 */
function scoreDemand(inputs: RawInputs): SubScore {
  const permits = normalize(inputs.permitsYoyPct.value, -30, 30);
  const employment = normalize(inputs.employmentYoyPct.value, -2, 5);
  const population = normalize(inputs.populationChangePct.value, -1, 3);
  const unemployment = normalizeInverse(inputs.unemploymentRate.value, 3, 8);
  const w = weightedAverage([
    [permits, 0.30],
    [employment, 0.25],
    [population, 0.25],
    [unemployment, 0.20],
  ]);
  return { score: w.score, inputsUsed: w.used, inputsMissing: w.missing };
}

/**
 * Operational sub-score — can we actually build here?
 *
 * Two inputs from QCEW (we deliberately skip OES — only 7 of 52 markets
 * have MSA-level OES coverage; QCEW covers all 52):
 *   - Construction wage YoY %, inverted on [0%, 10%]
 *     (wages rising fast = cost pressure on builders, so lower score)
 *   - Construction employment YoY %, on [-5%, +10%]
 *     (more trades showing up = easier to build, higher score)
 *
 * Weighted 60/40 toward the wage pressure signal — wage inflation is
 * the #1 thing that kills homebuilder margins and it's the signal the
 * CEO scenario specifically calls out.
 */
function scoreOperational(inputs: RawInputs): SubScore {
  const wagePressure = normalizeInverse(inputs.qcewWageYoyPct.value, 0, 10);
  const employmentTrajectory = normalize(inputs.qcewEmploymentYoyPct.value, -5, 10);
  const w = weightedAverage([
    [wagePressure, 0.6],
    [employmentTrajectory, 0.4],
  ]);
  return { score: w.score, inputsUsed: w.used, inputsMissing: w.missing };
}

// ─── Composite ──────────────────────────────────────────────────

export const DEFAULT_WEIGHTS = {
  financial: 0.40,
  demand: 0.30,
  operational: 0.30,
} as const;

/**
 * Blend the three sub-scores into a single composite using the default
 * Phase 1.2 weights. A null sub-score is excluded and remaining weights
 * are renormalized, matching the missing-data policy at the sub-score level.
 *
 * Phase 1.3 will expose this function (or a variant) for client-side
 * per-user re-blending. The cron only stores the default-weighted
 * composite — not a score matrix — because storing every weight
 * combination is pointless when the three sub-scores are all you need
 * to reconstruct any blend.
 */
export function blendComposite(
  financial: number | null,
  demand: number | null,
  operational: number | null,
  weights: { financial: number; demand: number; operational: number } = DEFAULT_WEIGHTS
): number | null {
  const w = weightedAverage([
    [financial, weights.financial],
    [demand, weights.demand],
    [operational, weights.operational],
  ]);
  return w.score;
}

/**
 * Main entry point. Takes the raw external inputs for one market and
 * returns all four scores plus the echoed inputs (for source tracing).
 */
export function computePortfolioHealth(inputs: RawInputs): PortfolioHealthResult {
  const financial = scoreFinancial(inputs);
  const demand = scoreDemand(inputs);
  const operational = scoreOperational(inputs);
  const composite = blendComposite(financial.score, demand.score, operational.score);
  return { financial, demand, operational, composite, inputs };
}

/**
 * Build an empty RawInputs shell with null values and a placeholder
 * source trace. Convenience for the pipeline, which fills in each
 * field as it reads from the corresponding external table.
 */
export function emptyInputs(): RawInputs {
  const empty: SourceTrace = { value: null, source: "", asOf: "" };
  return {
    permitsYoyPct: { ...empty },
    employmentYoyPct: { ...empty },
    unemploymentRate: { ...empty },
    populationChangePct: { ...empty },
    netDomesticMigration: { ...empty },
    medianHouseholdIncome: { ...empty },
    incomeYoyPct: { ...empty },
    qcewWageYoyPct: { ...empty },
    qcewEmploymentYoyPct: { ...empty },
  };
}
