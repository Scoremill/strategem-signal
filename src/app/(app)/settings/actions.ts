"use server";

import { getSession } from "@/lib/auth";
import { tenantQuery } from "@/lib/db";
import { trackedMarkets } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/**
 * Persist a user's personal market filter.
 *
 * The caller passes the desired set of geography ids; this action diffs
 * against the user's current tracked_markets rows and runs the minimal
 * inserts and deletes. All writes go through tenantQuery so the org
 * isolation guarantee still holds.
 *
 * No role gate — every logged-in user manages their own filter.
 */
export async function saveTrackedMarkets(geographyIds: string[]) {
  const session = await getSession();
  if (!session) {
    return { ok: false as const, error: "Not signed in" };
  }

  // De-dupe and validate the input shape — we don't want a malicious
  // client to confuse the diff with duplicate ids.
  const desired = Array.from(new Set(geographyIds.filter((id) => typeof id === "string" && id.length > 0)));

  const t = tenantQuery(session.orgId);

  // Pull the user's current rows. The org filter is auto-applied by
  // tenantQuery; the user filter is the caller's responsibility because
  // tracked_markets is per-user state inside the org.
  const current = (await t.select(
    trackedMarkets,
    eq(trackedMarkets.userId, session.userId)
  )) as Array<{ id: string; geographyId: string }>;

  const currentGeoIds = new Set(current.map((row) => row.geographyId));
  const desiredSet = new Set(desired);

  const toAdd = desired.filter((id) => !currentGeoIds.has(id));
  const toRemoveRowIds = current
    .filter((row) => !desiredSet.has(row.geographyId))
    .map((row) => row.id);

  // Inserts. tenantQuery.insert auto-fills org_id and the row id, so the
  // caller only needs user_id and geography_id.
  for (const geographyId of toAdd) {
    await t.insert(trackedMarkets, {
      userId: session.userId,
      geographyId,
    });
  }

  // Deletes. The user filter goes in the caller WHERE clause; the org
  // filter is AND-ed in by tenantQuery. Deleting by id is safe because
  // both filters still apply.
  if (toRemoveRowIds.length > 0) {
    await t.delete(
      trackedMarkets,
      and(
        eq(trackedMarkets.userId, session.userId),
        inArray(trackedMarkets.id, toRemoveRowIds)
      )!
    );
  }

  revalidatePath("/settings");
  return {
    ok: true as const,
    added: toAdd.length,
    removed: toRemoveRowIds.length,
    total: desired.length,
  };
}
