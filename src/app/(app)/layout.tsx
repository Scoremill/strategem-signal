import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { getSession } from "@/lib/auth";
import { userHasOnboarded } from "@/lib/onboarding";

/**
 * App-shell gate. Every authed user passes through here once per
 * navigation. If they haven't picked a weighting preset yet, we
 * intercept and send them to /welcome — that's Phase 4.9 onboarding.
 *
 * The check is a single-row lookup so the cost is negligible. The
 * /welcome route lives outside this (app) segment so it doesn't
 * recursively redirect.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  // Unauthenticated users are caught earlier by middleware; this
  // branch is a defensive fallback.
  if (!session) redirect("/sign-in");

  const onboarded = await userHasOnboarded(session.userId, session.orgId);
  if (!onboarded) redirect("/welcome");

  return <AppShell>{children}</AppShell>;
}
