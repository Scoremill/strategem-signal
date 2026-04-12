/**
 * Backfill BLS OEWS occupation data for all active markets.
 * Run: node --env-file=.env.local --import tsx scripts/run-oes.ts
 */
import { runOesPipeline } from "../src/lib/pipelines/oes-pipeline";

async function main() {
  console.log("Running OES pipeline for all active markets...\n");
  const result = await runOesPipeline();
  console.log(`\nMarkets: ${result.marketsProcessed}`);
  console.log(`Records: ${result.recordsInserted}`);
  if (result.errors.length) console.log("Errors:", result.errors);
}

main().catch((e) => { console.error(e); process.exit(1); });
