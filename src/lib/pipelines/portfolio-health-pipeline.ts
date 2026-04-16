/**
 * Portfolio Health snapshot pipeline.
 *
 * Once a month, for every active MSA in the geographies table:
 *   1. Read the latest row from each external table (permits, employment,
 *      migration, income, qcew)
 *   2. Call computePortfolioHealth() to get sub-scores + composite
 *   3. Upsert a row into portfolio_health_snapshots keyed by
 *      (geography_id, snapshot_date)
 *
 * Every input fed into the scorer carries its source table name and the
 * as-of date of the row that was used, so the drilldown "View Sources"
 * modal in Phase 1.6 can display full provenance per the CEO
 * traceability requirement.
 *
 * The whole pipeline is wrapped in per-market error isolation: if one
 * market's inputs are malformed, the rest still score and snapshot.
 */
import { db } from "@/lib/db";
import {
  geographies,
  permitData,
  employmentData,
  migrationData,
  incomeData,
  tradeCapacityData,
  portfolioHealthSnapshots,
} from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  computePortfolioHealth,
  emptyInputs,
  type RawInputs,
  type SourceTrace,
} from "@/lib/scoring/portfolio-health";

interface PipelineResult {
  marketsProcessed: number;
  marketsScored: number;
  marketsSkipped: number;
  errors: string[];
  durationMs: number;
}

/**
 * Today's date in YYYY-MM-DD for use as the snapshot_date column.
 * One run = one snapshot_date regardless of wall-clock time during
 * the run, so all rows from the same cron invocation share a key.
 */
function todayYmd(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * Convert a numeric-ish DB value (Drizzle decimal columns come back
 * as strings) to a JS number or null.
 */
function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a SourceTrace tuple from a raw value + source tag + as-of date.
 */
function trace(value: number | null, source: string, asOf: string): SourceTrace {
  return { value, source, asOf };
}

/**
 * Pull single-family permit YoY from the raw count time series. Compares
 * the latest month's value to the same month 12 months earlier, because
 * permits are highly seasonal (Dec dips, Mar spikes) and a MoM comparison
 * would be noise. The pre-computed yoy_change_pct column on permit_data
 * is populated inconsistently — we compute it ourselves here for
 * reliability and source transparency.
 */
async function loadPermits(geographyId: string): Promise<{
  yoyPct: SourceTrace;
}> {
  const rows = await db
    .select()
    .from(permitData)
    .where(eq(permitData.geographyId, geographyId))
    .orderBy(desc(permitData.periodDate))
    .limit(15);
  if (rows.length === 0) return { yoyPct: trace(null, "census_permits", "") };
  const latest = rows[0];
  // Find the row closest to "12 months ago". Prefer exactly 12 months; fall
  // back to 13 or 11 if the exact month is missing.
  const latestDate = new Date(latest.periodDate);
  let yearAgo: typeof latest | undefined;
  for (const candidate of rows) {
    const d = new Date(candidate.periodDate);
    const monthsApart =
      (latestDate.getFullYear() - d.getFullYear()) * 12 +
      (latestDate.getMonth() - d.getMonth());
    if (monthsApart === 12) {
      yearAgo = candidate;
      break;
    }
  }
  if (!yearAgo) {
    for (const candidate of rows) {
      const d = new Date(candidate.periodDate);
      const monthsApart =
        (latestDate.getFullYear() - d.getFullYear()) * 12 +
        (latestDate.getMonth() - d.getMonth());
      if (monthsApart === 11 || monthsApart === 13) {
        yearAgo = candidate;
        break;
      }
    }
  }
  const latestSf = latest.singleFamily ?? null;
  const priorSf = yearAgo?.singleFamily ?? null;
  const yoy =
    latestSf != null && priorSf != null && priorSf > 0
      ? ((latestSf - priorSf) / priorSf) * 100
      : null;
  return {
    yoyPct: trace(yoy, "census_permits", latest.periodDate),
  };
}

/**
 * Pull total_nonfarm and unemployment_rate from the raw employment time
 * series. Employment YoY is computed from the raw count (latest vs 12
 * months ago) because the pre-computed yoy_change_pct column is
 * populated inconsistently. Unemployment is handled separately because
 * BLS LAUS publishes ~1 month behind BLS CES, so the newest row may
 * have a null unemployment rate; we fall back to the most recent
 * non-null value.
 */
async function loadEmployment(geographyId: string): Promise<{
  employmentYoy: SourceTrace;
  unemployment: SourceTrace;
}> {
  const rows = await db
    .select()
    .from(employmentData)
    .where(eq(employmentData.geographyId, geographyId))
    .orderBy(desc(employmentData.periodDate))
    .limit(15);
  if (rows.length === 0) {
    return {
      employmentYoy: trace(null, "bls_ces", ""),
      unemployment: trace(null, "bls_laus", ""),
    };
  }
  const latest = rows[0];
  const latestDate = new Date(latest.periodDate);

  // Find the row exactly 12 months before the latest, falling back to
  // 11 or 13 if the exact month is missing.
  let yearAgo: typeof latest | undefined;
  for (const monthsOffset of [12, 13, 11]) {
    yearAgo = rows.find((r) => {
      const d = new Date(r.periodDate);
      return (
        (latestDate.getFullYear() - d.getFullYear()) * 12 +
          (latestDate.getMonth() - d.getMonth()) ===
        monthsOffset
      );
    });
    if (yearAgo) break;
  }

  const latestNonfarm = latest.totalNonfarm ?? null;
  const priorNonfarm = yearAgo?.totalNonfarm ?? null;
  const employmentYoyValue =
    latestNonfarm != null && priorNonfarm != null && priorNonfarm > 0
      ? ((latestNonfarm - priorNonfarm) / priorNonfarm) * 100
      : null;

  // Unemployment fallback: scan the already-fetched rows for the most
  // recent non-null rate before hitting the DB again.
  let unemploymentValue: number | null = toNumber(latest.unemploymentRate);
  let unemploymentAsOf = latest.periodDate;
  if (unemploymentValue == null) {
    const inMemoryFallback = rows.find((r) => r.unemploymentRate != null);
    if (inMemoryFallback) {
      unemploymentValue = toNumber(inMemoryFallback.unemploymentRate);
      unemploymentAsOf = inMemoryFallback.periodDate;
    }
  }

  return {
    employmentYoy: trace(employmentYoyValue, "bls_ces", latest.periodDate),
    unemployment: trace(unemploymentValue, "bls_laus", unemploymentAsOf),
  };
}

/**
 * Pull total_population from the raw migration time series and compute
 * YoY population change. The pre-computed population_change_pct column
 * is populated inconsistently (latest year often null), so we compute
 * it ourselves from the last two years of raw population counts. 9 of
 * 52 markets have no migration data at all; those return null traces
 * and the Demand sub-score renormalizes around the missing input.
 */
async function loadMigration(geographyId: string): Promise<{
  populationChange: SourceTrace;
  netDomestic: SourceTrace;
}> {
  const rows = await db
    .select()
    .from(migrationData)
    .where(eq(migrationData.geographyId, geographyId))
    .orderBy(desc(migrationData.year))
    .limit(3);
  if (rows.length === 0) {
    return {
      populationChange: trace(null, "census_pep", ""),
      netDomestic: trace(null, "census_pep", ""),
    };
  }
  const latest = rows[0];
  const prior = rows[1];
  const latestPop = latest.totalPopulation ?? null;
  const priorPop = prior?.totalPopulation ?? null;
  const popChangeValue =
    latestPop != null && priorPop != null && priorPop > 0
      ? ((latestPop - priorPop) / priorPop) * 100
      : null;
  return {
    populationChange: trace(popChangeValue, "census_pep", String(latest.year)),
    netDomestic: trace(latest.netDomesticMigration, "census_pep", String(latest.year)),
  };
}

/**
 * Pull the two most recent annual income rows and compute YoY ourselves
 * from median_household_income. The pre-computed yoy_change_pct column
 * is populated inconsistently, so we calculate it directly from the
 * last two vintages' raw income levels.
 */
async function loadIncome(geographyId: string): Promise<{
  level: SourceTrace;
  yoyPct: SourceTrace;
}> {
  const rows = await db
    .select()
    .from(incomeData)
    .where(eq(incomeData.geographyId, geographyId))
    .orderBy(desc(incomeData.year))
    .limit(3);
  if (rows.length === 0) {
    return {
      level: trace(null, "census_acs", ""),
      yoyPct: trace(null, "census_acs", ""),
    };
  }
  const latest = rows[0];
  const prior = rows[1];
  const latestIncome = latest.medianHouseholdIncome ?? null;
  const priorIncome = prior?.medianHouseholdIncome ?? null;
  const yoy =
    latestIncome != null && priorIncome != null && priorIncome > 0
      ? ((latestIncome - priorIncome) / priorIncome) * 100
      : null;
  return {
    level: trace(latestIncome, "census_acs", String(latest.year)),
    yoyPct: trace(yoy, "census_acs", String(latest.year)),
  };
}

/**
 * Pull the latest quarter of QCEW rows for this market and aggregate
 * across all construction NAICS codes into two weighted averages:
 *   - Wage YoY % weighted by avg_monthly_employment
 *   - Employment YoY % weighted by avg_monthly_employment
 *
 * Employment-weighted averages let a metro's largest construction
 * sub-sector drive the signal rather than treating every NAICS code
 * equally — that matches the homebuilder reality where residential
 * specialty trades dwarf heavy-civil in total labor.
 */
async function loadQcew(geographyId: string): Promise<{
  wageYoy: SourceTrace;
  employmentYoy: SourceTrace;
}> {
  // Pull the latest period_date for this geography, then all rows on
  // that date. Matches the "per-market max date" pattern used elsewhere.
  const rows = await db
    .select()
    .from(tradeCapacityData)
    .where(
      and(
        eq(tradeCapacityData.geographyId, geographyId),
        sql`${tradeCapacityData.periodDate} = (
          SELECT MAX(${tradeCapacityData.periodDate})
          FROM ${tradeCapacityData}
          WHERE ${tradeCapacityData.geographyId} = ${geographyId}
        )`
      )
    );
  if (rows.length === 0) {
    return {
      wageYoy: trace(null, "bls_qcew", ""),
      employmentYoy: trace(null, "bls_qcew", ""),
    };
  }

  let totalWeight = 0;
  let wageSum = 0;
  let wageWeight = 0;
  let empSum = 0;
  let empWeight = 0;
  for (const row of rows) {
    const emp = row.avgMonthlyEmployment ?? 0;
    if (emp <= 0) continue;
    totalWeight += emp;
    const w = toNumber(row.wageYoyChangePct);
    const e = toNumber(row.employmentYoyChangePct);
    if (w != null) {
      wageSum += w * emp;
      wageWeight += emp;
    }
    if (e != null) {
      empSum += e * emp;
      empWeight += emp;
    }
  }

  const asOf = rows[0].periodDate;
  return {
    wageYoy: trace(
      wageWeight > 0 ? wageSum / wageWeight : null,
      "bls_qcew",
      asOf
    ),
    employmentYoy: trace(
      empWeight > 0 ? empSum / empWeight : null,
      "bls_qcew",
      asOf
    ),
  };
}

/**
 * Build the full RawInputs for a single market by fanning out across
 * every external table.
 */
async function loadInputsForMarket(geographyId: string): Promise<RawInputs> {
  const [permits, employment, migration, income, qcew] = await Promise.all([
    loadPermits(geographyId),
    loadEmployment(geographyId),
    loadMigration(geographyId),
    loadIncome(geographyId),
    loadQcew(geographyId),
  ]);

  const inputs = emptyInputs();
  inputs.permitsYoyPct = permits.yoyPct;
  inputs.employmentYoyPct = employment.employmentYoy;
  inputs.unemploymentRate = employment.unemployment;
  inputs.populationChangePct = migration.populationChange;
  inputs.netDomesticMigration = migration.netDomestic;
  inputs.medianHouseholdIncome = income.level;
  inputs.incomeYoyPct = income.yoyPct;
  inputs.qcewWageYoyPct = qcew.wageYoy;
  inputs.qcewEmploymentYoyPct = qcew.employmentYoy;
  return inputs;
}

/**
 * Run the snapshot pipeline for every active market. Returns a summary
 * that the cron route logs to fetch_logs and returns in the HTTP response.
 */
export async function runPortfolioHealthPipeline(): Promise<PipelineResult> {
  const startedAt = Date.now();
  const snapshotDate = todayYmd();
  const result: PipelineResult = {
    marketsProcessed: 0,
    marketsScored: 0,
    marketsSkipped: 0,
    errors: [],
    durationMs: 0,
  };

  const markets = await db
    .select()
    .from(geographies)
    .where(eq(geographies.isActive, true));
  console.log(
    `[portfolio-health] Starting snapshot ${snapshotDate} for ${markets.length} markets`
  );

  for (const market of markets) {
    result.marketsProcessed++;
    try {
      const inputs = await loadInputsForMarket(market.id);
      const scored = computePortfolioHealth(inputs);

      // Skip markets where we couldn't compute any sub-score at all.
      // This only happens if the federal pipelines haven't run yet.
      if (
        scored.financial.score == null &&
        scored.demand.score == null &&
        scored.operational.score == null
      ) {
        result.marketsSkipped++;
        continue;
      }

      await db
        .insert(portfolioHealthSnapshots)
        .values({
          id: randomUUID(),
          geographyId: market.id,
          snapshotDate,
          financialScore:
            scored.financial.score != null
              ? scored.financial.score.toFixed(2)
              : null,
          demandScore:
            scored.demand.score != null ? scored.demand.score.toFixed(2) : null,
          operationalScore:
            scored.operational.score != null
              ? scored.operational.score.toFixed(2)
              : null,
          compositeScore:
            scored.composite != null ? scored.composite.toFixed(2) : null,
          inputsJson: scored.inputs,
        })
        .onConflictDoUpdate({
          target: [
            portfolioHealthSnapshots.geographyId,
            portfolioHealthSnapshots.snapshotDate,
          ],
          set: {
            financialScore:
              scored.financial.score != null
                ? scored.financial.score.toFixed(2)
                : null,
            demandScore:
              scored.demand.score != null
                ? scored.demand.score.toFixed(2)
                : null,
            operationalScore:
              scored.operational.score != null
                ? scored.operational.score.toFixed(2)
                : null,
            compositeScore:
              scored.composite != null ? scored.composite.toFixed(2) : null,
            inputsJson: scored.inputs,
          },
        });
      result.marketsScored++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ✗ ${market.shortName}: ${msg}`);
      result.errors.push(`${market.shortName}: ${msg}`);
    }
  }

  result.durationMs = Date.now() - startedAt;
  console.log(
    `[portfolio-health] Done: scored ${result.marketsScored}/${result.marketsProcessed}, skipped ${result.marketsSkipped}, ${result.errors.length} errors, ${result.durationMs}ms`
  );
  return result;
}
