/**
 * One-shot bootstrap: create the first user + org + owner membership.
 *
 * Run once after Phase 0.11 lands so the new multi-tenant login flow has
 * a real user to authenticate against. Reads ADMIN_EMAIL and
 * ADMIN_PASSWORD from .env.local for the user identity.
 *
 * Idempotent: re-running with the same email finds the existing user
 * and skips the create. Re-running with a different ADMIN_EMAIL creates
 * a new user but reuses the same org if a "strategem" org already exists.
 *
 * Run: node --env-file=.env.local --import tsx scripts/bootstrap-first-org.ts
 */
import { db } from "../src/lib/db";
import { users, orgs, orgMemberships } from "../src/lib/db/schema";
import { hashPassword } from "../src/lib/auth";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME ?? "Drew Stevens";
  const orgName = process.env.BOOTSTRAP_ORG_NAME ?? "Strategem";
  const orgSlug = process.env.BOOTSTRAP_ORG_SLUG ?? "strategem";

  if (!adminEmail || !adminPassword) {
    console.error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env.local");
    process.exit(1);
  }

  console.log("Bootstrapping first org + user...\n");
  console.log(`  email:    ${adminEmail}`);
  console.log(`  name:     ${adminName}`);
  console.log(`  org:      ${orgName} (slug: ${orgSlug})`);
  console.log("");

  // 1. User
  let [existingUser] = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
  if (existingUser) {
    console.log(`  ✓ User already exists (id ${existingUser.id})`);
  } else {
    const passwordHash = await hashPassword(adminPassword);
    [existingUser] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        email: adminEmail,
        passwordHash,
        name: adminName,
        emailVerifiedAt: new Date(),
      })
      .returning();
    console.log(`  ✓ Created user (id ${existingUser.id})`);
  }

  // 2. Org
  let [existingOrg] = await db.select().from(orgs).where(eq(orgs.slug, orgSlug)).limit(1);
  if (existingOrg) {
    console.log(`  ✓ Org already exists (id ${existingOrg.id})`);
  } else {
    const trialEnds = new Date();
    trialEnds.setDate(trialEnds.getDate() + 30); // 30-day trial for the seed org
    [existingOrg] = await db
      .insert(orgs)
      .values({
        id: randomUUID(),
        name: orgName,
        slug: orgSlug,
        subscriptionStatus: "trial",
        trialEndsAt: trialEnds,
      })
      .returning();
    console.log(`  ✓ Created org (id ${existingOrg.id})`);
  }

  // 3. Owner membership
  const [existingMembership] = await db
    .select()
    .from(orgMemberships)
    .where(eq(orgMemberships.userId, existingUser.id))
    .limit(1);

  if (existingMembership && existingMembership.orgId === existingOrg.id) {
    console.log(`  ✓ Owner membership already exists (role=${existingMembership.role})`);
  } else if (existingMembership) {
    console.log(`  ⚠ User has a membership in a different org (${existingMembership.orgId}); not modifying`);
  } else {
    await db.insert(orgMemberships).values({
      id: randomUUID(),
      userId: existingUser.id,
      orgId: existingOrg.id,
      role: "owner",
      joinedAt: new Date(),
    });
    console.log(`  ✓ Created owner membership`);
  }

  console.log("\nBootstrap complete. You can now log in with these credentials.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
