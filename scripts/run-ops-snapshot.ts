/**
 * One-shot manual run of the StrategemOps snapshot pipeline.
 * Used to bootstrap Phase 0.6 (first ever snapshot) and as an emergency
 * manual trigger if the GitHub Actions cron is down.
 *
 * Run: node --env-file=.env.local --import tsx scripts/run-ops-snapshot.ts
 */
import { runOpsSnapshotPipeline } from "../src/lib/pipelines/ops-snapshot-pipeline";

async function main() {
  console.log("Running StrategemOps snapshot pipeline...\n");
  const result = await runOpsSnapshotPipeline();

  console.log("\n=== Snapshot Result ===");
  console.log(`Status:        ${result.status}`);
  console.log(`Total rows:    ${result.totalRowsUpserted}`);
  console.log(`Duration:      ${result.durationMs}ms`);
  console.log(`Errors:        ${result.errors.length}`);

  console.log("\n=== Per-Table Results ===");
  for (const t of result.tables) {
    const flag = t.error ? "✗" : "✓";
    console.log(
      `  ${flag} ${t.table.padEnd(35)} fetched=${String(t.rowsFetched).padStart(5)} ` +
      `upserted=${String(t.rowsUpserted).padStart(5)} ${t.durationMs}ms` +
      (t.error ? ` ERROR: ${t.error}` : "")
    );
  }

  if (result.errors.length > 0) {
    console.log("\n=== Errors ===");
    for (const e of result.errors) console.log(`  ${e}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
