/**
 * Welcome / onboarding page.
 *
 * Phase 4.9. First-login users land here before the app shell. Three
 * short steps — welcome, pick a weighting preset, pick a handful of
 * markets to track — then onwards to the heatmap. Users who've
 * already onboarded (health_score_weights row exists) are bounced
 * straight to the app.
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { geographies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { userHasOnboarded } from "@/lib/onboarding";
import WelcomeClient from "./WelcomeClient";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  // Already onboarded? Don't re-trap them here.
  if (await userHasOnboarded(session.userId, session.orgId)) {
    redirect("/heatmap");
  }

  // Pull the active market directory for the step-3 picker. ~200 rows;
  // one query, server-rendered.
  const markets = await db
    .select({
      id: geographies.id,
      shortName: geographies.shortName,
      state: geographies.state,
      cbsaFips: geographies.cbsaFips,
    })
    .from(geographies)
    .where(eq(geographies.isActive, true))
    .orderBy(geographies.shortName);

  return (
    <WelcomeClient
      userName={session.name ?? session.email.split("@")[0] ?? "there"}
      orgName={session.orgSlug}
      markets={markets}
    />
  );
}
