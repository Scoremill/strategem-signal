/**
 * Market Opportunity snapshot pipeline.
 *
 * Once a month, for every active MSA:
 *   1. Load raw inputs from the DB (migration, permits, employment)
 *   2. Fetch the BLS QCEW 2-digit NAICS sector breakdown live (Filter 2
 *      needs this, and we don't have a stored sector table yet —
 *      we piggyback on the already-working QCEW fetch pattern)
 *   3. Call computeMarketOpportunity() to get six filter scores
 *   4. Upsert a market_opportunity_scores row keyed by
 *      (geography_id, snapshot_date)
 *
 * Filter 4 (Competitive Landscape) and Filter 5 (Affordability Runway)
 * are stubbed — they return null + reason="data_pending". See the
 * scoring module for the full rationale.
 *
 * The in-run sector cache keeps us to one BLS request per market; ~52
 * markets × ~300ms each = ~15-20 seconds added to the run, well under
 * the Vercel 300s cap.
 */
import { db } from "@/lib/db";
import {
  geographies,
  permitData,
  migrationData,
  marketOpportunityScores,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  computeMarketOpportunity,
  emptyMarketOpportunityInputs,
  type MarketOpportunityInputs,
  type SourceTrace,
} from "@/lib/scoring/market-opportunity";
import { cbsaToQcewArea, getLatestQcewQuarter } from "./qcew-client";

interface PipelineResult {
  marketsProcessed: number;
  marketsScored: number;
  marketsSkipped: number;
  errors: string[];
  durationMs: number;
}

// ─── Helpers ────────────────────────────────────────────────────

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function trace(
  value: number | null,
  source: string,
  asOf: string
): SourceTrace {
  return { value, source, asOf };
}

// ─── DB loaders ─────────────────────────────────────────────────

/**
 * Compute single-family permit YoY from the raw time series. Same
 * approach as the portfolio-health pipeline — compare the latest
 * month to the same month 12 (or 11/13) months earlier.
 */
async function loadPermitsYoy(geographyId: string): Promise<SourceTrace> {
  const rows = await db
    .select()
    .from(permitData)
    .where(eq(permitData.geographyId, geographyId))
    .orderBy(desc(permitData.periodDate))
    .limit(15);
  if (rows.length === 0) return trace(null, "census_permits", "");
  const latest = rows[0];
  const latestDate = new Date(latest.periodDate);
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
  const latestSf = latest.singleFamily ?? null;
  const priorSf = yearAgo?.singleFamily ?? null;
  const yoy =
    latestSf != null && priorSf != null && priorSf > 0
      ? ((latestSf - priorSf) / priorSf) * 100
      : null;
  return trace(yoy, "census_permits", latest.periodDate);
}

/**
 * Load migration data (net domestic migration + total population) from
 * the last two annual rows and compute population YoY change from the
 * raw counts. Mirrors the portfolio-health pipeline.
 */
async function loadMigration(geographyId: string): Promise<{
  netDomestic: SourceTrace;
  totalPopulation: SourceTrace;
  priorYearPopulation: SourceTrace;
  populationChangePct: SourceTrace;
}> {
  const rows = await db
    .select()
    .from(migrationData)
    .where(eq(migrationData.geographyId, geographyId))
    .orderBy(desc(migrationData.year))
    .limit(3);
  if (rows.length === 0) {
    return {
      netDomestic: trace(null, "census_pep", ""),
      totalPopulation: trace(null, "census_pep", ""),
      priorYearPopulation: trace(null, "census_pep", ""),
      populationChangePct: trace(null, "census_pep", ""),
    };
  }
  const latest = rows[0];
  const prior = rows[1];
  const latestPop = latest.totalPopulation ?? null;
  const priorPop = prior?.totalPopulation ?? null;
  const popChange =
    latestPop != null && priorPop != null && priorPop > 0
      ? ((latestPop - priorPop) / priorPop) * 100
      : null;
  const latestYear = String(latest.year);
  return {
    netDomestic: trace(latest.netDomesticMigration, "census_pep", latestYear),
    totalPopulation: trace(latestPop, "census_pep", latestYear),
    priorYearPopulation: trace(priorPop, "census_pep", prior ? String(prior.year) : ""),
    populationChangePct: trace(popChange, "census_pep", latestYear),
  };
}

/**
 * Load BLS CES total nonfarm + unemployment (used only for Filter 6
 * QCEW-weighted aggregation). We don't actually need CES here — the
 * construction NAICS 238x data is already in trade_capacity_data.
 * This is a stub for now; Filter 6 reads trade_capacity_data in
 * loadOperationalFromQcew().
 */

/**
 * Load Filter 6 operational inputs by aggregating the existing
 * trade_capacity_data rows (NAICS 238x, already populated by the
 * capacity pipeline). Employment-weighted average across the 4 trade
 * NAICS codes — same math as the portfolio-health pipeline's
 * loadQcew() so both screens agree on "operational feasibility."
 */
async function loadOperationalFromQcew(geographyId: string): Promise<{
  wageYoy: SourceTrace;
  employmentYoy: SourceTrace;
}> {
  const { tradeCapacityData } = await import("@/lib/db/schema");
  const { sql, and } = await import("drizzle-orm");
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
  let wageSum = 0;
  let wageWeight = 0;
  let empSum = 0;
  let empWeight = 0;
  for (const row of rows) {
    const emp = row.avgMonthlyEmployment ?? 0;
    if (emp <= 0) continue;
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
    wageYoy: trace(wageWeight > 0 ? wageSum / wageWeight : null, "bls_qcew", asOf),
    employmentYoy: trace(empWeight > 0 ? empSum / empWeight : null, "bls_qcew", asOf),
  };
}

// ─── Filter 2: 2-digit NAICS sector breakdown ───────────────────

/**
 * Fetch the 2-digit NAICS sector employment breakdown for an MSA from
 * BLS QCEW. Returns { "23": 145000, "31-33": 220000, "54": 180000, ... }
 * keyed by NAICS 2-digit supersector code, values are avg monthly
 * employment for the latest available quarter.
 *
 * We filter on industry_code patterns that match 2-digit supersectors:
 * either a 2-character code ("11", "21", "23", "42", "51", "52", ...)
 * or the multi-digit manufacturing/retail/transportation ranges
 * ("31-33", "44-45", "48-49"). We explicitly exclude "10" (Total,
 * all industries) and "1011"/"1012"/"1013" (the aggregate supersectors
 * Goods-producing / Service-providing / etc.) — we want the disjoint
 * 2-digit sectors for a clean HHI.
 *
 * Respects the MSA_COUNTY_FALLBACK for metros where BLS suppresses
 * MSA-level NAICS 238x data. For those, we fall back to the state-level
 * aggregate instead of doing a full county fanout — the 2-digit sector
 * shape doesn't require the same precision as the 4-digit trade count,
 * and county fanouts would push the pipeline past 60 seconds easily.
 */
const SECTOR_NAICS_CODES = new Set([
  "11", // Agriculture, Forestry, Fishing, Hunting
  "21", // Mining, Quarrying, Oil/Gas
  "22", // Utilities
  "23", // Construction
  "31-33", // Manufacturing
  "42", // Wholesale Trade
  "44-45", // Retail Trade
  "48-49", // Transportation & Warehousing
  "51", // Information
  "52", // Finance & Insurance
  "53", // Real Estate & Rental
  "54", // Professional, Scientific, Technical Services
  "55", // Management
  "56", // Administrative & Waste Services
  "61", // Educational Services
  "62", // Health Care & Social Assistance
  "71", // Arts, Entertainment, Recreation
  "72", // Accommodation & Food Services
  "81", // Other Services
  "92", // Public Administration
]);

interface SectorBreakdown {
  breakdown: Record<string, number>;
  asOf: string;
}

/**
 * Resolve the most recent BLS QCEW quarter that actually has PUBLISHED
 * sector data. Probed ONCE at pipeline start via a single Dallas fetch
 * (area C1910) and cached for every market in the same run.
 *
 * A 200-OK response alone is not enough — BLS returns HTTP 200 with
 * placeholder rows (all zero employment, disclosure="-") during the
 * ~3 months between a quarter ending and its actual publication.
 * We probe by parsing the response and confirming at least one
 * 2-digit sector row has a non-zero employment count.
 */
async function resolveLatestAvailableQuarter(): Promise<{
  year: number;
  quarter: number;
} | null> {
  const latest = getLatestQcewQuarter();
  let y = latest.year;
  let q = latest.quarter;
  for (let i = 0; i < 6; i++) {
    const url = `https://data.bls.gov/cew/data/api/${y}/${q}/area/C1910.csv`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const parsed = parseSectorCsv(await res.text());
        if (parsed && Object.keys(parsed).length > 0) {
          return { year: y, quarter: q };
        }
      }
    } catch {
      // fall through to the next quarter
    }
    q--;
    if (q < 1) {
      q = 4;
      y--;
    }
  }
  return null;
}

async function fetchSectorBreakdown(
  cbsaFips: string,
  qtr: { year: number; quarter: number } | null
): Promise<SectorBreakdown | null> {
  if (!qtr) return null;
  const areaCode = cbsaToQcewArea(cbsaFips);
  const url = `https://data.bls.gov/cew/data/api/${qtr.year}/${qtr.quarter}/area/${areaCode}.csv`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const parsed = parseSectorCsv(await res.text());
    if (!parsed) return null;
    return { breakdown: parsed, asOf: `${qtr.year}-Q${qtr.quarter}` };
  } catch {
    return null;
  }
}

/**
 * Parse the BLS QCEW CSV and return a 2-digit NAICS sector breakdown.
 * Filters to private ownership (own_code=5) at MSA × 2-digit sector
 * granularity (agglvl_code=44). See the comment inside the body for
 * why we use own_code=5 rather than the unavailable own_code=0 rollup.
 */
function parseSectorCsv(text: string): Record<string, number> | null {
  const lines = text.split("\n");
  if (lines.length < 2) return null;
  const headers = parseCsvHeader(lines[0]);
  const ownCodeIdx = headers.indexOf("own_code");
  const industryCodeIdx = headers.indexOf("industry_code");
  const agglvlIdx = headers.indexOf("agglvl_code");
  const m1Idx = headers.indexOf("month1_emplvl");
  const m2Idx = headers.indexOf("month2_emplvl");
  const m3Idx = headers.indexOf("month3_emplvl");
  const disclosureIdx = headers.indexOf("disclosure_code");
  if (ownCodeIdx === -1 || industryCodeIdx === -1 || agglvlIdx === -1) return null;
  const breakdown: Record<string, number> = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCsvLine(lines[i]);
    if (values[ownCodeIdx] !== "5") continue;
    if (values[agglvlIdx] !== "44") continue;
    const ic = values[industryCodeIdx];
    if (!SECTOR_NAICS_CODES.has(ic)) continue;
    if (disclosureIdx !== -1 && values[disclosureIdx] === "N") continue;
    const m1 = parseInt(values[m1Idx] || "0") || 0;
    const m2 = parseInt(values[m2Idx] || "0") || 0;
    const m3 = parseInt(values[m3Idx] || "0") || 0;
    const avgEmp = Math.round((m1 + m2 + m3) / 3);
    if (avgEmp <= 0) continue;
    breakdown[ic] = avgEmp;
  }
  return Object.keys(breakdown).length > 0 ? breakdown : null;
}

// Minimal CSV parser inlined here (the one in qcew-client.ts isn't
// exported and duplicating a 15-line function beats refactoring).
function parseCsvHeader(line: string): string[] {
  return parseCsvLine(line);
}
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ─── Main pipeline ──────────────────────────────────────────────

async function loadInputsForMarket(
  geographyId: string,
  cbsaFips: string,
  qtr: { year: number; quarter: number } | null
): Promise<MarketOpportunityInputs> {
  const [permitsYoy, migration, operational, sectorData] = await Promise.all([
    loadPermitsYoy(geographyId),
    loadMigration(geographyId),
    loadOperationalFromQcew(geographyId),
    fetchSectorBreakdown(cbsaFips, qtr),
  ]);

  const inputs = emptyMarketOpportunityInputs();
  inputs.permitsYoyPct = permitsYoy;
  inputs.netDomesticMigration = migration.netDomestic;
  inputs.totalPopulation = migration.totalPopulation;
  inputs.priorYearPopulation = migration.priorYearPopulation;
  inputs.populationChangePct = migration.populationChangePct;
  inputs.qcewWageYoyPct = operational.wageYoy;
  inputs.qcewEmploymentYoyPct = operational.employmentYoy;
  inputs.sectorEmployment = {
    value: sectorData ? Object.values(sectorData.breakdown).reduce((a, b) => a + b, 0) : null,
    source: "bls_qcew",
    asOf: sectorData?.asOf ?? "",
    breakdown: sectorData?.breakdown,
  };
  return inputs;
}

export async function runMarketOpportunityPipeline(): Promise<PipelineResult> {
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
    `[market-opportunity] Starting snapshot ${snapshotDate} for ${markets.length} markets`
  );

  // One BLS probe at run start so every market fetches from the same
  // known-good quarter instead of rediscovering the latest available.
  const qtr = await resolveLatestAvailableQuarter();
  if (qtr) {
    console.log(`[market-opportunity] Using QCEW ${qtr.year} Q${qtr.quarter} for sector breakdown`);
  } else {
    console.warn(`[market-opportunity] Could not resolve any QCEW quarter; Filter 2 will be null`);
  }

  for (const market of markets) {
    result.marketsProcessed++;
    try {
      const inputs = await loadInputsForMarket(market.id, market.cbsaFips, qtr);
      const scored = computeMarketOpportunity(inputs);

      // Skip only if we literally computed nothing (all six filters null)
      if (
        scored.filter1.score == null &&
        scored.filter2.score == null &&
        scored.filter3.score == null &&
        scored.filter4.score == null &&
        scored.filter5.score == null &&
        scored.filter6.score == null
      ) {
        result.marketsSkipped++;
        continue;
      }

      await db
        .insert(marketOpportunityScores)
        .values({
          id: randomUUID(),
          geographyId: market.id,
          snapshotDate,
          filter1Migration: scored.filter1.score?.toFixed(2) ?? null,
          filter2Diversity: scored.filter2.score?.toFixed(2) ?? null,
          filter3Imbalance: scored.filter3.score?.toFixed(2) ?? null,
          filter4Competitive: scored.filter4.score?.toFixed(2) ?? null,
          filter5Affordability: scored.filter5.score?.toFixed(2) ?? null,
          filter6Operational: scored.filter6.score?.toFixed(2) ?? null,
          numGreen: scored.numGreen,
          allSixGreen: scored.allSixGreen,
          inputsJson: scored.inputs,
        })
        .onConflictDoUpdate({
          target: [
            marketOpportunityScores.geographyId,
            marketOpportunityScores.snapshotDate,
          ],
          set: {
            filter1Migration: scored.filter1.score?.toFixed(2) ?? null,
            filter2Diversity: scored.filter2.score?.toFixed(2) ?? null,
            filter3Imbalance: scored.filter3.score?.toFixed(2) ?? null,
            filter4Competitive: scored.filter4.score?.toFixed(2) ?? null,
            filter5Affordability: scored.filter5.score?.toFixed(2) ?? null,
            filter6Operational: scored.filter6.score?.toFixed(2) ?? null,
            numGreen: scored.numGreen,
            allSixGreen: scored.allSixGreen,
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
    `[market-opportunity] Done: scored ${result.marketsScored}/${result.marketsProcessed}, skipped ${result.marketsSkipped}, ${result.errors.length} errors, ${result.durationMs}ms`
  );
  return result;
}

