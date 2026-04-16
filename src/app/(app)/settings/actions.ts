"use server";

import { getSession } from "@/lib/auth";
import { db, tenantQuery } from "@/lib/db";
import {
  trackedMarkets,
  healthScoreWeights,
  watchlistMarkets,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import {
  WEIGHT_PRESETS,
  type PresetName,
} from "@/lib/scoring/weight-presets";
import { recordAudit } from "@/lib/audit";

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

  if (toAdd.length > 0 || toRemoveRowIds.length > 0) {
    await recordAudit({
      orgId: session.orgId,
      userId: session.userId,
      action: "tracked_markets.updated",
      entityType: "tracked_markets",
      after: {
        added: toAdd,
        removedRowIds: toRemoveRowIds,
        totalAfter: desired.length,
      },
    });
  }

  revalidatePath("/settings");
  return {
    ok: true as const,
    added: toAdd.length,
    removed: toRemoveRowIds.length,
    total: desired.length,
  };
}

/**
 * Save the user's chosen weighting preset. The three sub-scores live in
 * portfolio_health_snapshots; the preset determines how they blend into
 * the composite the user sees in the heatmap and ranking table. No
 * pipeline re-run is needed — the composite is re-computed client-side
 * on read.
 *
 * Stored in health_score_weights keyed on (user_id, org_id) so a user
 * can have a different preference in each org they belong to.
 */
export async function saveWeightPreset(presetName: string) {
  const session = await getSession();
  if (!session) {
    return { ok: false as const, error: "Not signed in" };
  }

  const preset = WEIGHT_PRESETS[presetName as PresetName];
  if (!preset) {
    return { ok: false as const, error: `Unknown preset: ${presetName}` };
  }

  // Cross-tenant table with composite PK — tenantQuery helper doesn't
  // cover composite PKs cleanly, so we go through the raw db client and
  // constrain by both user_id and org_id in the WHERE clause.
  await db
    .insert(healthScoreWeights)
    .values({
      userId: session.userId,
      orgId: session.orgId,
      weightFinancial: preset.weights.financial.toFixed(3),
      weightDemand: preset.weights.demand.toFixed(3),
      weightOperational: preset.weights.operational.toFixed(3),
      presetName: preset.name,
    })
    .onConflictDoUpdate({
      target: [healthScoreWeights.userId, healthScoreWeights.orgId],
      set: {
        weightFinancial: preset.weights.financial.toFixed(3),
        weightDemand: preset.weights.demand.toFixed(3),
        weightOperational: preset.weights.operational.toFixed(3),
        presetName: preset.name,
        updatedAt: new Date(),
      },
    });

  await recordAudit({
    orgId: session.orgId,
    userId: session.userId,
    action: "weights.updated",
    entityType: "health_score_weights",
    after: { presetName: preset.name, weights: preset.weights },
  });

  revalidatePath("/settings");
  return { ok: true as const, preset: preset.name };
}

/**
 * Add or remove a market from the logged-in user's personal watchlist.
 * Called from the star button on each row in /opportunities. Per-user
 * scoped (same model as tracked_markets and health_score_weights), so
 * a user's watchlist is independent of their teammates'.
 */
export async function toggleWatchlistMarket(
  geographyId: string,
  desired: boolean
) {
  const session = await getSession();
  if (!session) {
    return { ok: false as const, error: "Not signed in" };
  }
  if (typeof geographyId !== "string" || geographyId.length === 0) {
    return { ok: false as const, error: "Invalid geographyId" };
  }

  if (desired) {
    // Add. ON CONFLICT DO NOTHING keeps the call idempotent — a double-
    // click on the star button shouldn't throw.
    await db
      .insert(watchlistMarkets)
      .values({
        id: randomUUID(),
        orgId: session.orgId,
        userId: session.userId,
        geographyId,
      })
      .onConflictDoNothing();
  } else {
    // Remove. Scoped to the user + geography so we can't accidentally
    // remove another user's watchlist entry.
    await db
      .delete(watchlistMarkets)
      .where(
        and(
          eq(watchlistMarkets.userId, session.userId),
          eq(watchlistMarkets.geographyId, geographyId)
        )
      );
  }

  await recordAudit({
    orgId: session.orgId,
    userId: session.userId,
    action: desired ? "watchlist.added" : "watchlist.removed",
    entityType: "watchlist_markets",
    entityId: geographyId,
  });

  revalidatePath("/opportunities");
  return { ok: true as const, onWatchlist: desired };
}
