/**
 * Onboarding detection.
 *
 * A user is considered "onboarded" once they have a row in
 * health_score_weights — meaning they picked a weighting preset
 * during the welcome flow (Phase 4.9). First-login users are
 * redirected from the app shell to /welcome.
 *
 * This signal is cheap to check (single-row lookup by composite
 * PK) and it degrades gracefully: if the DB is unreachable the
 * check returns true, so a transient failure doesn't trap a user
 * on the onboarding page forever.
 */
import { db } from "@/lib/db";
import { healthScoreWeights } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function userHasOnboarded(
  userId: string,
  orgId: string,
): Promise<boolean> {
  try {
    const rows = await db
      .select({ userId: healthScoreWeights.userId })
      .from(healthScoreWeights)
      .where(
        and(
          eq(healthScoreWeights.userId, userId),
          eq(healthScoreWeights.orgId, orgId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    console.error("[onboarding] check failed, treating as onboarded", err);
    return true;
  }
}
