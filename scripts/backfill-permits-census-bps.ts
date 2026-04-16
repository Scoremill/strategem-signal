/**
 * Backfill permit_data from Census BPS for every active geography.
 * Replaces the partial FRED-based permits data from Phase 2.1 with
 * complete Census BPS data covering all ~384 US MSAs.
 *
 * Strategy:
 *   1. DELETE all existing permit_data rows (clean slate — no mixed
 *      sources, idempotent re-runs). Source labels in the existing
 *      rows are "fred", "fred_backfill", "fred_county_agg", "fred_
 *      backfill_sf_only".
 *   2. Fetch Census BPS monthly .xls files from 2023-01 through the
 *      latest published month (~6-week lag from today)
 *   3. For each monthly file, loop through all 199 active markets
 *      and insert a permit_data row keyed by (geography_id, period_date)
 *   4. Census BPS returns data indexed by CBSA FIPS, so joining to
 *      geographies is a direct match
 *
 * No county-aggregation fallback needed — Census BPS has all metros
 * natively.
 *
 * Runtime estimate: 37 months × ~2 sec per .xls download/parse ≈ 1-2
 * minutes, plus ~200 inserts per month = ~7,400 inserts at ~30ms each
 * = 4 minutes. Total ~5-6 min.
 */
import { db } from "../src/lib/db";
import { geographies, permitData } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { fetchBpsMonth, monthRange } from "../src/lib/pipelines/census-bps-client";

async function main() {
  const startedAt = Date.now();

  console.log("[backfill-bps] Clearing existing permit_data rows...");
  const deleted = await db.delete(permitData);
  console.log(`  Deleted ${Array.isArray(deleted) ? deleted.length : "?"} existing rows`);

  // Map cbsa_fips → geography_id for fast lookup
  const geos = await db
    .select({
      id: geographies.id,
      cbsaFips: geographies.cbsaFips,
      shortName: geographies.shortName,
    })
    .from(geographies)
    .where(eq(geographies.isActive, true));
  const geoByCbsa = new Map(geos.map((g) => [g.cbsaFips, g]));
  console.log(`  ${geos.length} active markets to backfill`);

  // Backfill 2023-01 through 2026-02 (Census lag typically allows ~Feb by mid-April).
  // The loop will 404-skip any month Census hasn't published yet.
  const months = monthRange({ year: 2023, month: 1 }, { year: 2026, month: 2 });
  console.log(`  ${months.length} months to fetch (${months[0].year}-${months[0].month} through ${months[months.length - 1].year}-${months[months.length - 1].month})`);

  let monthsFetched = 0;
  let monthsSkipped = 0;
  let rowsInserted = 0;
  const errors: string[] = [];

  for (const { year, month } of months) {
    try {
      const bpsRows = await fetchBpsMonth(year, month);
      if (bpsRows == null) {
        monthsSkipped++;
        console.log(`  ${year}-${String(month).padStart(2, "0")}: not yet published, skipping`);
        continue;
      }

      const periodDate = `${year}-${String(month).padStart(2, "0")}-01`;
      let monthRows = 0;
      for (const bps of bpsRows) {
        const geo = geoByCbsa.get(bps.cbsaFips);
        if (!geo) continue; // not a market we track
        await db
          .insert(permitData)
          .values({
            id: randomUUID(),
            geographyId: geo.id,
            periodDate,
            totalPermits: bps.totalUnits,
            singleFamily: bps.singleFamily,
            multiFamily: bps.multiFamily,
            source: "census_bps",
          })
          .onConflictDoNothing();
        monthRows++;
      }
      rowsInserted += monthRows;
      monthsFetched++;
      if (monthsFetched % 6 === 0) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(`  ${monthsFetched} months fetched, ${rowsInserted} rows, elapsed ${elapsed}s`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${year}-${String(month).padStart(2, "0")}: ${msg}`);
      console.warn(`  ${year}-${String(month).padStart(2, "0")}: ${msg}`);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n[backfill-bps] Done in ${elapsed}s`);
  console.log(`  Months fetched: ${monthsFetched}`);
  console.log(`  Months skipped (not published): ${monthsSkipped}`);
  console.log(`  Rows inserted: ${rowsInserted}`);
  console.log(`  Errors: ${errors.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
