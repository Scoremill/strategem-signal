/**
 * One-off Zillow ZHVI backfill: writes full 2023-present history for
 * every matched geography. The monthly cron at /api/cron/zillow-zhvi
 * only writes the latest 90 days, so we need this seed run once when
 * first wiring up the table (or when adding a large number of new
 * markets).
 *
 * Idempotent — the pipeline upserts on (geography_id, period_date).
 */
import { runZillowZhviPipeline } from "../src/lib/pipelines/zillow-zhvi-pipeline";

async function main() {
  const result = await runZillowZhviPipeline({ minDate: "2023-01-01" });
  console.log("\n=== Backfill result ===");
  console.log(`  Markets processed: ${result.marketsProcessed}`);
  console.log(`  Markets matched: ${result.marketsMatched}`);
  console.log(`  Rows inserted: ${result.rowsInserted}`);
  console.log(`  Errors: ${result.errors.length}`);
  if (result.unmatched.length > 0) {
    console.log(`\n  Unmatched (${result.unmatched.length}):`);
    for (const u of result.unmatched) console.log(`    ${u}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
