/**
 * Run the scoring engine across all active markets.
 * Required after adding new markets so percentile rankings are recomputed.
 * Run: node --env-file=.env.local --import tsx scripts/run-scoring.ts
 */
import { runScoringEngine } from "../src/lib/scoring/engine";

async function main() {
  console.log("Running scoring engine for all active markets...\n");
  const result = await runScoringEngine();
  console.log(`\nMarkets scored: ${result.marketsScored}`);
  if (result.errors?.length) console.log("Errors:", result.errors);
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
