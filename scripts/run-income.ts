/**
 * Backfill Census ACS median household income for all active markets.
 * Run: node --env-file=.env.local --import tsx scripts/run-income.ts
 */
import { runIncomePipeline } from "../src/lib/pipelines/income-pipeline";

async function main() {
  console.log("Running income pipeline for all active markets...\n");
  const result = await runIncomePipeline();
  console.log(`\nMarkets: ${result.marketsProcessed}`);
  console.log(`Records: ${result.recordsInserted}`);
  if (result.errors.length) console.log("Errors:", result.errors);
}

main().catch((e) => { console.error(e); process.exit(1); });
