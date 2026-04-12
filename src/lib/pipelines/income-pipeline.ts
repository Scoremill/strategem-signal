/**
 * Census ACS household income pipeline.
 * Fetches median household income (table B19013) for all monitored MSAs
 * from the ACS 1-year estimates and stores in income_data.
 *
 * The 1-year ACS publishes ~September each year for the prior year. We pull
 * the 3 most recent vintages so YoY change is computable.
 *
 * No API key required (Census API is free); registering one bumps the
 * rate limit but isn't necessary for our weekly cadence.
 */
import { db } from "@/lib/db";
import { geographies, incomeData } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

const ACS_BASE = "https://api.census.gov/data";

interface IncomePipelineResult {
  marketsProcessed: number;
  recordsInserted: number;
  errors: string[];
}

/**
 * Fetch median household income for a specific ACS vintage year.
 * Returns a Map of CBSA FIPS → median income.
 */
async function fetchAcsMedianIncome(vintage: number): Promise<Map<string, number>> {
  const url = `${ACS_BASE}/${vintage}/acs/acs1?get=NAME,B19013_001E&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:*`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ACS API ${vintage} HTTP ${res.status}`);
  }
  const rows: string[][] = await res.json();
  const result = new Map<string, number>();
  // First row is headers
  for (let i = 1; i < rows.length; i++) {
    const [, value, cbsa] = rows[i];
    const v = parseInt(value, 10);
    if (Number.isFinite(v) && v > 0) result.set(cbsa, v);
  }
  return result;
}

export async function runIncomePipeline(
  options: { cbsaFilter?: string[] } = {}
): Promise<IncomePipelineResult> {
  const result: IncomePipelineResult = { marketsProcessed: 0, recordsInserted: 0, errors: [] };

  const markets = options.cbsaFilter?.length
    ? await db
        .select()
        .from(geographies)
        .where(and(eq(geographies.isActive, true), inArray(geographies.cbsaFips, options.cbsaFilter)))
    : await db.select().from(geographies).where(eq(geographies.isActive, true));

  // ACS 1-year publishes for the prior year by September. Pull 3 vintages so YoY
  // change is computable even if the most recent vintage hasn't released yet.
  const currentYear = new Date().getFullYear();
  const vintages = [currentYear - 3, currentYear - 2, currentYear - 1];

  console.log(
    `[income-pipeline] Starting for ${markets.length} markets, vintages ${vintages.join(",")}`
  );

  // Fetch each vintage once (one API call per year, all MSAs)
  const byVintage = new Map<number, Map<string, number>>();
  for (const v of vintages) {
    try {
      const data = await fetchAcsMedianIncome(v);
      byVintage.set(v, data);
      console.log(`  ✓ ACS ${v}: ${data.size} MSAs`);
    } catch (err) {
      const msg = `acs/${v}: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`  ${msg}`);
      // Skip vintages that haven't been published yet — not a fatal error
    }
  }

  // For each market × vintage we have data for, insert the row with computed YoY
  for (const market of markets) {
    let marketRecords = 0;
    const sortedVintages = [...byVintage.keys()].sort((a, b) => a - b);

    for (let i = 0; i < sortedVintages.length; i++) {
      const year = sortedVintages[i];
      const data = byVintage.get(year)!;
      const value = data.get(market.cbsaFips);
      if (value == null) continue;

      // Compute YoY using the prior vintage's value
      let yoy: number | null = null;
      if (i > 0) {
        const prior = byVintage.get(sortedVintages[i - 1])?.get(market.cbsaFips);
        if (prior && prior > 0) {
          yoy = ((value - prior) / prior) * 100;
        }
      }

      try {
        await db
          .insert(incomeData)
          .values({
            id: randomUUID(),
            geographyId: market.id,
            year,
            medianHouseholdIncome: value,
            yoyChangePct: yoy != null ? String(yoy.toFixed(2)) : null,
            source: "census_acs",
          })
          .onConflictDoNothing();
        marketRecords++;
      } catch (err) {
        result.errors.push(
          `${market.shortName}/${year}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (marketRecords > 0) {
      result.recordsInserted += marketRecords;
      result.marketsProcessed++;
    }
  }

  console.log(
    `[income-pipeline] Done: ${result.marketsProcessed} markets, ${result.recordsInserted} records, ${result.errors.length} errors`
  );

  return result;
}
