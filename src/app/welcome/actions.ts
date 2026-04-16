"use server";

/**
 * Welcome / onboarding server action.
 *
 * Phase 4.9. The welcome flow collects two things from a brand-new
 * user before dropping them into the app:
 *
 *   1. A weighting preset (writes health_score_weights).
 *   2. An initial set of tracked markets (writes tracked_markets).
 *
 * Writing both at once is the cleanest commit pattern — if a user
 * reloads mid-flow, we start clean rather than mid-state. The
 * onboarding check gates on the presence of a health_score_weights
 * row, so nothing is "half-onboarded" as far as the app is concerned.
 */
import { getSession } from "@/lib/auth";
import { db, tenantQuery } from "@/lib/db";
import { healthScoreWeights, trackedMarkets } from "@/lib/db/schema";
import { recordAudit } from "@/lib/audit";
import {
  WEIGHT_PRESETS,
  type PresetName,
} from "@/lib/scoring/weight-presets";
import { redirect } from "next/navigation";

export interface CompleteOnboardingArgs {
  presetName: string;
  trackedGeographyIds: string[];
}

export async function completeOnboarding(args: CompleteOnboardingArgs) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const preset = WEIGHT_PRESETS[args.presetName as PresetName];
  if (!preset) {
    return { ok: false as const, error: `Unknown preset: ${args.presetName}` };
  }

  const geographyIds = Array.from(
    new Set(
      (args.trackedGeographyIds ?? []).filter(
        (id) => typeof id === "string" && id.length > 0,
      ),
    ),
  );

  // 1) Write weighting preset.
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

  // 2) Insert tracked markets if the user picked any.
  if (geographyIds.length > 0) {
    const t = tenantQuery(session.orgId);
    for (const geographyId of geographyIds) {
      await t.insert(trackedMarkets, {
        userId: session.userId,
        geographyId,
      });
    }
  }

  // 3) Audit the onboarding event.
  await recordAudit({
    orgId: session.orgId,
    userId: session.userId,
    action: "user.onboarded",
    after: {
      presetName: preset.name,
      trackedMarketCount: geographyIds.length,
    },
  });

  redirect("/heatmap");
}
