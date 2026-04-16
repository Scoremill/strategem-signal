/**
 * Tenant isolation smoke test.
 *
 * Creates two test orgs, each with one test user, inserts a tracked_markets
 * row (user-scoped) into each, queries each org's data through tenantQuery,
 * and verifies the helper correctly isolates the rows. Cleans up after itself.
 *
 * Run: node --env-file=.env.local --import tsx scripts/test-tenant-isolation.ts
 *
 * If this script ever fails, the multi-tenant guarantee is broken.
 */
import { db, tenantQuery } from "../src/lib/db";
import { orgs, users, trackedMarkets, geographies } from "../src/lib/db/schema";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

const FAIL = (msg: string): never => {
  console.error(`✗ FAIL: ${msg}`);
  process.exit(1);
};

async function main() {
  console.log("=== Tenant isolation smoke test ===\n");

  // Pick two real geographies — the second one lets us test insert
  // injection without colliding with the (user_id, geography_id) unique index.
  const geosResult = await db.select().from(geographies).limit(2);
  if (geosResult.length < 2) FAIL("need at least 2 geographies in DB");
  const [geo, geo2] = geosResult;
  console.log(`Using geographies: ${geo.shortName}, ${geo2.shortName}`);

  // Create two test orgs with one test user each
  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  await db.insert(orgs).values([
    { id: orgAId, name: "TEST Org A", slug: `test-a-${orgAId.slice(0, 8)}` },
    { id: orgBId, name: "TEST Org B", slug: `test-b-${orgBId.slice(0, 8)}` },
  ]);
  await db.insert(users).values([
    { id: userAId, email: `test-a-${userAId.slice(0, 8)}@example.com`, passwordHash: "x" },
    { id: userBId, email: `test-b-${userBId.slice(0, 8)}@example.com`, passwordHash: "x" },
  ]);
  console.log(`Created orgs: A=${orgAId.slice(0, 8)} B=${orgBId.slice(0, 8)}`);
  console.log(`Created users: A=${userAId.slice(0, 8)} B=${userBId.slice(0, 8)}`);

  try {
    // Each user tracks the same geography under a different org
    const tA = tenantQuery(orgAId);
    const tB = tenantQuery(orgBId);

    await tA.insert(trackedMarkets, { userId: userAId, geographyId: geo.id });
    await tB.insert(trackedMarkets, { userId: userBId, geographyId: geo.id });
    console.log("Inserted one tracked_markets row into each org\n");

    // Org A's view should contain exactly 1 row (its own)
    const aRows = await tA.select(trackedMarkets);
    if (aRows.length !== 1) FAIL(`org A saw ${aRows.length} rows, expected 1`);
    if ((aRows[0] as { orgId: string }).orgId !== orgAId)
      FAIL(`org A row has wrong orgId ${(aRows[0] as { orgId: string }).orgId}`);
    console.log(`✓ Org A sees 1 row, owned by org A`);

    // Org B's view should also contain exactly 1 row (its own)
    const bRows = await tB.select(trackedMarkets);
    if (bRows.length !== 1) FAIL(`org B saw ${bRows.length} rows, expected 1`);
    if ((bRows[0] as { orgId: string }).orgId !== orgBId)
      FAIL(`org B row has wrong orgId ${(bRows[0] as { orgId: string }).orgId}`);
    console.log(`✓ Org B sees 1 row, owned by org B`);

    // Cross-tenant write protection: org A tries to update org B's row
    // by id. The helper should silently match zero rows because the org
    // filter is AND-ed in.
    const bRowId = (bRows[0] as { id: string }).id;
    const updated = (await tA.update(
      trackedMarkets,
      { userId: userAId },
      eq(trackedMarkets.id, bRowId)
    )) as unknown[];
    if (updated.length !== 0)
      FAIL(`org A was able to update org B's row (${updated.length} rows affected)`);
    console.log(`✓ Org A cannot update org B's row by id (0 rows affected)`);

    // Cross-tenant delete protection
    const deleted = (await tA.delete(trackedMarkets, eq(trackedMarkets.id, bRowId))) as unknown[];
    if (deleted.length !== 0)
      FAIL(`org A was able to delete org B's row (${deleted.length} rows affected)`);
    console.log(`✓ Org A cannot delete org B's row by id (0 rows affected)`);

    // Org B's row should still exist
    const bRowsAfter = await tB.select(trackedMarkets);
    if (bRowsAfter.length !== 1)
      FAIL(`org B has ${bRowsAfter.length} rows after attempted cross-tenant ops, expected 1`);
    console.log(`✓ Org B's row survived the cross-tenant attacks`);

    // Insert ignores any orgId the caller passes — it always uses the
    // bound orgId. Try to inject org B's id from org A's helper, using a
    // different geography to avoid colliding with the (user_id, geography_id)
    // unique index from the earlier inserts.
    const sneaky = (await tA.insert(trackedMarkets, {
      orgId: orgBId, // attempted injection
      userId: userAId,
      geographyId: geo2.id,
    })) as Array<{ orgId: string }>;
    const injectedRow = sneaky[0];
    if (injectedRow.orgId !== orgAId)
      FAIL(`insert injection succeeded: row has orgId ${injectedRow.orgId}, expected ${orgAId}`);
    console.log(`✓ Insert injection blocked: row landed under org A despite caller passing org B's id`);

    console.log("\n=== All tenant isolation checks passed ===");
  } finally {
    // Cleanup — cascade deletes both tracked_markets rows
    await db.delete(orgs).where(eq(orgs.id, orgAId));
    await db.delete(orgs).where(eq(orgs.id, orgBId));
    await db.delete(users).where(eq(users.id, userAId));
    await db.delete(users).where(eq(users.id, userBId));
    console.log("Cleaned up test orgs and users");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
