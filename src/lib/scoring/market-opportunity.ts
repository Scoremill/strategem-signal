/**
 * Market Opportunity — six independent filters, external-only.
 *
 * Pure functions. No database imports. The pipeline feeds raw inputs in;
 * these functions return 0-100 scores with a per-filter inputs trace.
 *
 * Six filters per CEO requirement section 2.2:
 *
 *   1. Migration Tailwinds      — Census PEP net domestic migration
 *                                 as % of population
 *   2. Employment Diversity     — BLS QCEW sector HHI, inverted (lower
 *                                 concentration = higher diversity)
 *   3. Supply-Demand Imbalance  — permit growth vs population growth;
 *                                 a market building too little for its
 *                                 growth earns a HIGH imbalance score
 *                                 (it's an opportunity, not a weakness)
 *   4. Competitive Landscape    — STUB (StrategemOps lacks a builder→
 *                                 market mapping; light up when that
 *                                 data source exists)
 *   5. Affordability Runway     — STUB (FHFA House Price Index pipeline
 *                                 not built yet; deferred to pre-Phase-3)
 *   6. Operational Feasibility  — BLS QCEW wage YoY (inverted) + QCEW
 *                                 construction employment YoY. Reuses
 *                                 the Phase 1 Operational sub-score math.
 *
 * A filter is "green" if score >= 60, matching the heatmap's
 * emerald-600 threshold. num_green counts the passing filters; the
 * all_six_green headline flag from PLAN.md is true only when all six
 * clear the bar (which requires filters 4 and 5 to exist first).
 *
 * Every input fed to a filter carries a { value, source, asOf } trace
 * in the returned inputsJson so the filter drilldown at
 * /opportunities/[market]/filter/[n] can show exact provenance.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface SourceTrace {
  value: number | null;
  source: string; // e.g. "census_pep"
  asOf: string; // ISO date or year
}

export interface MarketOpportunityInputs {
  // Filter 1 — Migration
  netDomesticMigration: SourceTrace;
  totalPopulation: SourceTrace;
  priorYearPopulation: SourceTrace;

  // Filter 2 — Employment Diversity
  // NAICS breakdown: { "23": 145000, "62": 180000, ... }, values are avg
  // monthly employment from QCEW. The scorer computes an HHI across the
  // sectors present. The source trace carries the dominant sector label.
  sectorEmployment: SourceTrace & {
    breakdown?: Record<string, number>;
  };

  // Filter 3 — Supply-Demand Imbalance
  permitsYoyPct: SourceTrace;
  populationChangePct: SourceTrace;

  // Filter 4 — Competitive Landscape
  // Count of distinct public homebuilders known to operate in the
  // market, plus a list of their tickers. Sourced from
  // ops_builder_markets (LLM-parsed earnings narratives).
  publicBuilderCount: SourceTrace & {
    tickers?: string[];
  };

  // Filter 5 — Affordability Runway
  // HPI trajectory vs income trajectory. The scorer compares income
  // growth to home price growth — a positive delta means runway is
  // expanding (incomes outrunning prices), negative means it's
  // compressing (prices outrunning incomes).
  hpiYoyPct: SourceTrace;
  incomeYoyPct: SourceTrace;

  // Filter 6 — Operational Feasibility
  qcewWageYoyPct: SourceTrace;
  qcewEmploymentYoyPct: SourceTrace;
}

export interface FilterScore {
  score: number | null;
  green: boolean; // score >= 60
  reason?: string; // e.g. "data_pending" for stubs
}

export interface MarketOpportunityResult {
  filter1: FilterScore;
  filter2: FilterScore;
  filter3: FilterScore;
  filter4: FilterScore;
  filter5: FilterScore;
  filter6: FilterScore;
  numGreen: number;
  allSixGreen: boolean;
  inputs: MarketOpportunityInputs;
}

export const GREEN_THRESHOLD = 60;

// ─── Normalizers ────────────────────────────────────────────────

/** Linear normalize to [0, 100] over [min, max]; null preserved. */
function normalize(value: number | null, min: number, max: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (max === min) return 50;
  const clamped = Math.max(min, Math.min(max, value));
  return ((clamped - min) / (max - min)) * 100;
}

/** Inverse normalize: higher raw = lower score. */
function normalizeInverse(value: number | null, min: number, max: number): number | null {
  const n = normalize(value, min, max);
  return n == null ? null : 100 - n;
}

function pack(score: number | null, reason?: string): FilterScore {
  return {
    score,
    green: score != null && score >= GREEN_THRESHOLD,
    reason,
  };
}

// ─── Filter 1 — Migration Tailwinds ─────────────────────────────

/**
 * Score migration as a percentage of total population. A metro gaining
 * 50k people on a base of 5M is a 1% tailwind — strong. A metro losing
 * 20k on 2M is a -1% outflow — weak.
 *
 * Normalized on [-0.5%, +1.5%]:
 *   -0.5% → 0  (significant outflow)
 *    0.0% → 25 (flat)
 *    0.5% → 50 (modest inflow)
 *    1.0% → 75 (strong inflow)
 *   +1.5% → 100 (boom-town)
 */
function scoreMigration(inputs: MarketOpportunityInputs): FilterScore {
  const migration = inputs.netDomesticMigration.value;
  const population = inputs.totalPopulation.value;
  if (migration == null || population == null || population <= 0) {
    // Fallback: if we don't have explicit net migration but we do have
    // population change %, use that instead. Same units, same meaning.
    const popChange = inputs.populationChangePct.value;
    if (popChange != null) {
      return pack(normalize(popChange, -0.5, 1.5));
    }
    return pack(null);
  }
  const migrationPct = (migration / population) * 100;
  return pack(normalize(migrationPct, -0.5, 1.5));
}

// ─── Filter 2 — Employment Diversity ────────────────────────────

/**
 * Score using the Herfindahl-Hirschman Index (HHI) across NAICS 2-digit
 * sector employment shares. HHI = sum of squared market shares
 * expressed as percentages (so a market with a single sector scores
 * 10000; a perfectly diverse market with 20 equal sectors scores 500).
 *
 * A homebuilder CEO wants diversified employment — a market where one
 * employer or one sector can collapse the whole economy is bad news
 * even if the current numbers look great (see: Silicon Valley ~2001,
 * oil towns ~2015). The scorer inverts HHI onto a 0-100 scale.
 *
 * Real-world metro HHIs with full 15-20 sector coverage range from
 * ~400 (very diverse — DFW, NYC, Atlanta) to ~2000 (heavily
 * concentrated — small single-industry towns). Normalized inverse
 * on [400, 2000]. The floor was recalibrated from 800 after fixing
 * the BLS disclosure-suppression parser to include all sectors.
 */
function scoreDiversity(inputs: MarketOpportunityInputs): FilterScore {
  const breakdown = inputs.sectorEmployment.breakdown;
  if (!breakdown || Object.keys(breakdown).length === 0) {
    return pack(null);
  }
  const values = Object.values(breakdown).filter((v) => v > 0);
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return pack(null);
  let hhi = 0;
  for (const v of values) {
    const share = (v / total) * 100;
    hhi += share * share;
  }
  return pack(normalizeInverse(hhi, 400, 2000));
}

// ─── Filter 3 — Supply-Demand Imbalance ─────────────────────────

/**
 * Score the GAP between population growth and permit growth. A market
 * growing population at +2% but with permits at -20% is severely under-
 * building — that's an opportunity (the CEO scenario is "find places
 * where demand exists but supply is lagging"). A market where permits
 * are keeping pace with (or outrunning) population isn't an imbalance.
 *
 * We subtract permit YoY from population YoY × 10 (since population
 * moves in tenths of a percent while permits swing 30%+):
 *   gap = (populationYoy * 10) - permitsYoy
 *
 * Interpretation:
 *   gap = +40 → population +2%, permits -20% → severe under-building
 *   gap =  +5 → balanced
 *   gap = -10 → permits outrunning population → over-building
 *
 * Normalized on [-10, +40]: over-built markets land near 0, severely
 * under-built markets land near 100.
 */
function scoreImbalance(inputs: MarketOpportunityInputs): FilterScore {
  const permits = inputs.permitsYoyPct.value;
  const popGrowth = inputs.populationChangePct.value;
  if (permits == null || popGrowth == null) return pack(null);
  const gap = popGrowth * 10 - permits;
  return pack(normalize(gap, -10, 40));
}

// ─── Filter 4 — Competitive Landscape ───────────────────────────

/**
 * Score a market on the INVERSE of public-builder concentration. The
 * fewer public builders operating there, the higher the score — a
 * market where you'd face less price competition and have a cleaner
 * runway for organic entry.
 *
 * Data source: ops_builder_markets, which is the LLM-parsed output
 * of public builder earnings narratives (see scripts/parse-ops-
 * builder-markets.ts). Each row is a (builder_ticker, geography_id)
 * pair with a mention_count and confidence.
 *
 * Normalization:
 *   0 builders  → 100 (uncontested, wide open — rare among tracked metros)
 *   4 builders  → 67  (light competition, mid-sized metro)
 *   8 builders  → 33  (established market)
 *   12+ builders → 0  (saturated, organic entry is expensive)
 *
 * Known limits of this signal:
 *   - The LLM only sees what public builders disclose. Private
 *     builders, regional operators, and developer partnerships are
 *     invisible to this count. A metro scoring "low competition"
 *     here may still be crowded with privately-held players.
 *   - 2 of 20 builders (MTH, LGIH, NVR, PHM historically) disclose
 *     with less geographic specificity, so their markets are
 *     under-represented.
 *   - Inverted score means "fewer = better for entering fresh"
 *     but doesn't say "fewer = better market overall." A 0-builder
 *     market might be uncontested OR it might be a market no one
 *     wants. Always read alongside Filters 1 and 3.
 *
 * This is a CEO-scenario signal: "is this market crowded with public
 * builders?" Answers in a single number for the table and an explicit
 * list of tickers for the drilldown.
 */
function scoreCompetitive(inputs: MarketOpportunityInputs): FilterScore {
  const count = inputs.publicBuilderCount.value;
  if (count == null) return pack(null);
  // Inverse normalize on [0, 12]
  return pack(normalizeInverse(count, 0, 12));
}

// ─── Filter 5 — Affordability Runway ────────────────────────────

/**
 * Score the gap between income growth and home price growth. Classic
 * affordability measures (price-to-income ratio) require a dollar home
 * price, which FHFA HPI doesn't give us directly — it's an index, not
 * a price. So instead of measuring "is this market affordable today,"
 * the filter measures "is affordability getting better or worse?" —
 * which is the 5-year CEO horizon lens anyway.
 *
 * Two components:
 *   - Trajectory (70% weight): incomeYoyPct - hpiYoyPct. Positive =
 *     incomes outrunning prices, runway expanding. Normalized on
 *     [-4, +4] (a 4-point-per-year trajectory gap is extreme in either
 *     direction).
 *   - Price stability (30% weight): HPI YoY itself on an inverse-U
 *     curve. Modest growth (2-6%) is healthy; flat or negative signals
 *     cooling/correction; very high (10%+) signals bubble risk.
 *     Peak at 4%.
 *
 * A market where incomes grow 5% and HPI grows 3% scores high on
 * trajectory (runway expanding 2pp/year) and moderate on stability
 * (HPI near the sweet spot). A market where HPI grows 10% while
 * incomes grow 3% scores low on both.
 */
function scoreAffordability(inputs: MarketOpportunityInputs): FilterScore {
  const hpi = inputs.hpiYoyPct.value;
  const income = inputs.incomeYoyPct.value;
  if (hpi == null && income == null) return pack(null);

  // Trajectory: normalize (income - hpi) on [-4, +4]
  let trajectoryScore: number | null = null;
  if (hpi != null && income != null) {
    const delta = income - hpi;
    trajectoryScore = normalize(delta, -4, 4);
  }

  // Stability: inverse-U on HPI YoY, peak at 4%
  let stabilityScore: number | null = null;
  if (hpi != null) {
    const distanceFromPeak = Math.abs(hpi - 4);
    // 0 distance → 100, 6 or more distance → 0, linear between
    stabilityScore = Math.max(0, 100 - (distanceFromPeak / 6) * 100);
  }

  // Weighted blend — 70% trajectory, 30% stability. Null-aware:
  // if only one component is present, it carries the full weight.
  const parts: Array<[number, number]> = [];
  if (trajectoryScore != null) parts.push([trajectoryScore, 0.7]);
  if (stabilityScore != null) parts.push([stabilityScore, 0.3]);
  if (parts.length === 0) return pack(null);
  let sum = 0;
  let wsum = 0;
  for (const [s, w] of parts) {
    sum += s * w;
    wsum += w;
  }
  return pack(sum / wsum);
}

// ─── Filter 6 — Operational Feasibility ─────────────────────────

/**
 * Reuses the Phase 1 Operational sub-score math so the two screens
 * agree on what "operational" means:
 *   - QCEW construction wage YoY (inverted on [0%, 10%]) — lower wage
 *     inflation is better for builder margins
 *   - QCEW construction employment YoY (on [-5%, +10%]) — more trades
 *     means easier to build
 * Weighted 60/40 toward wage pressure (#1 margin killer).
 */
function scoreOperational(inputs: MarketOpportunityInputs): FilterScore {
  const wagePressure = normalizeInverse(inputs.qcewWageYoyPct.value, 0, 10);
  const employmentTrajectory = normalize(inputs.qcewEmploymentYoyPct.value, -5, 10);
  const parts: Array<[number, number]> = [];
  if (wagePressure != null) parts.push([wagePressure, 0.6]);
  if (employmentTrajectory != null) parts.push([employmentTrajectory, 0.4]);
  if (parts.length === 0) return pack(null);
  let sum = 0;
  let wsum = 0;
  for (const [s, w] of parts) {
    sum += s * w;
    wsum += w;
  }
  return pack(sum / wsum);
}

// ─── Composite ──────────────────────────────────────────────────

export function computeMarketOpportunity(
  inputs: MarketOpportunityInputs
): MarketOpportunityResult {
  const filter1 = scoreMigration(inputs);
  const filter2 = scoreDiversity(inputs);
  const filter3 = scoreImbalance(inputs);
  const filter4 = scoreCompetitive(inputs);
  const filter5 = scoreAffordability(inputs);
  const filter6 = scoreOperational(inputs);
  const filters = [filter1, filter2, filter3, filter4, filter5, filter6];
  const numGreen = filters.filter((f) => f.green).length;
  const allSixGreen = filters.every((f) => f.green); // true only when every filter passes (including stubs)
  return {
    filter1,
    filter2,
    filter3,
    filter4,
    filter5,
    filter6,
    numGreen,
    allSixGreen,
    inputs,
  };
}

export function emptyMarketOpportunityInputs(): MarketOpportunityInputs {
  const empty: SourceTrace = { value: null, source: "", asOf: "" };
  return {
    netDomesticMigration: { ...empty },
    totalPopulation: { ...empty },
    priorYearPopulation: { ...empty },
    sectorEmployment: { ...empty },
    permitsYoyPct: { ...empty },
    populationChangePct: { ...empty },
    publicBuilderCount: { ...empty },
    hpiYoyPct: { ...empty },
    incomeYoyPct: { ...empty },
    qcewWageYoyPct: { ...empty },
    qcewEmploymentYoyPct: { ...empty },
  };
}

/**
 * Display metadata for each filter. Used by the /opportunities table,
 * the filter drilldown page headers, and anywhere else we need to
 * label a filter consistently.
 */
export interface FilterMeta {
  n: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  shortLabel: string;
  description: string;
  isStub: boolean;
  columnKey:
    | "filter1"
    | "filter2"
    | "filter3"
    | "filter4"
    | "filter5"
    | "filter6";
}

export const FILTER_META: FilterMeta[] = [
  {
    n: 1,
    label: "Migration Tailwinds",
    shortLabel: "Migration",
    description: "Net domestic migration as a share of total population. Rewards metros where people are actually moving in.",
    isStub: false,
    columnKey: "filter1",
  },
  {
    n: 2,
    label: "Employment Diversity",
    shortLabel: "Diversity",
    description: "Herfindahl-Hirschman index across NAICS sectors. Penalizes markets where one sector dominates employment.",
    isStub: false,
    columnKey: "filter2",
  },
  {
    n: 3,
    label: "Supply-Demand Imbalance",
    shortLabel: "Imbalance",
    description: "Population growth vs permit growth. Rewards markets where demand is running ahead of supply — the CEO 'find under-built metros' lens.",
    isStub: false,
    columnKey: "filter3",
  },
  {
    n: 4,
    label: "Competitive Landscape",
    shortLabel: "Competition",
    description: "Count of public homebuilders known to operate in this market (via LLM-parsed StrategemOps earnings narratives). Inverted — fewer competitors score higher. Private builders and small regionals are invisible to this count, so read alongside Filters 1 and 3.",
    isStub: false,
    columnKey: "filter4",
  },
  {
    n: 5,
    label: "Affordability Runway",
    shortLabel: "Affordability",
    description: "Income growth vs FHFA House Price Index growth. Rewards markets where incomes are outrunning home prices (runway expanding) and penalizes markets with price bubbles or flat/negative HPI.",
    isStub: false,
    columnKey: "filter5",
  },
  {
    n: 6,
    label: "Operational Feasibility",
    shortLabel: "Operational",
    description: "BLS QCEW construction wage growth and trade employment trajectory. Rewards markets where you can actually complete on schedule.",
    isStub: false,
    columnKey: "filter6",
  },
];
