/**
 * Targeted backfill for the 9 newly added markets only.
 * Calls the demand and capacity pipelines directly, filtering to the new CBSAs.
 * Run: node --env-file=.env.local --import tsx scripts/run-9-backfill.ts
 */
import { db } from "../src/lib/db";
import { geographies } from "../src/lib/db/schema";
import { runDemandPipelineForCbsas } from "../src/lib/pipelines/demand-pipeline";
import { runCapacityPipelineForCbsas } from "../src/lib/pipelines/capacity-pipeline";
import { inArray } from "drizzle-orm";

const NEW_CBSAS = [
  "38300", "46060", "28140", "40060", "13820",
  "32820", "10740", "30780", "27140",
];

async function main() {
  console.log(`Backfilling ${NEW_CBSAS.length} new markets...\n`);

  const markets = await db.select().from(geographies).where(inArray(geographies.cbsaFips, NEW_CBSAS));
  console.log(`Found ${markets.length} markets in DB\n`);

  console.log("=== DEMAND BACKFILL ===");
  const demand = await runDemandPipelineForCbsas(NEW_CBSAS, true);
  console.log(`Permits: ${demand.permitsInserted}`);
  console.log(`Employment: ${demand.employmentInserted}`);
  console.log(`Population: ${demand.populationInserted}`);
  if (demand.errors.length) console.log("Errors:", demand.errors);

  console.log("\n=== CAPACITY BACKFILL ===");
  const capacity = await runCapacityPipelineForCbsas(NEW_CBSAS, true);
  console.log(`Records inserted: ${capacity.recordsInserted}`);
  console.log(`Quarters processed: ${capacity.quartersProcessed}`);
  if (capacity.errors.length) console.log("Errors:", capacity.errors);

  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
