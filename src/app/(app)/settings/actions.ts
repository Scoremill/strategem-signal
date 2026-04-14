"use server";

import { getSession } from "@/lib/auth";
import { db, tenantQuery } from "@/lib/db";
import { trackedMarkets, healthScoreWeights } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  WEIGHT_PRESETS,
  type PresetName,
} from "@/lib/scoring/weight-presets";

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

  revalidatePath("/settings");
  return { ok: true as const, preset: preset.name };
}
