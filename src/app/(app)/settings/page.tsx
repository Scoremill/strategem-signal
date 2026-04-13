/**
 * Org settings shell.
 *
 * Placeholder for the multi-tenant org settings UI. Phase 1 fills the
 * sections in with real functionality:
 *
 *   - Org Profile: name, slug, logo
 *   - Members: invite, role assignment, remove
 *   - Tracked Markets: which MSAs the org actively monitors
 *   - Health Score Weighting: Financial / Demand / Operational sliders
 *   - Subscription: Stripe portal link (after launch)
 *   - Audit Log: chronological list of every settings change
 *
 * For Phase 0.13 we just render the chrome and the labeled section
 * placeholders so the route exists, the sidebar entry works, and the
 * owner-only gate is testable.
 */
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { orgs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const PLACEHOLDER_SECTIONS: Array<{
  title: string;
  description: string;
  status: string;
}> = [
  {
    title: "Org Profile",
    description: "Organization name, slug, and logo. Used in the topbar and email digest.",
    status: "Coming in Phase 1",
  },
  {
    title: "Members",
    description: "Invite users, assign roles (CEO, CFO, COO, Division President, Member), or remove access.",
    status: "Coming in Phase 1",
  },
  {
    title: "Tracked Markets",
    description: "The MSAs your organization actively monitors. Phase 1 Portfolio Health View only scores markets in this list.",
    status: "Coming in Phase 1",
  },
  {
    title: "Health Score Weighting",
    description: "Tune the composite Portfolio Health score across Financial, Demand, and Operational sub-scores. Stored per-org.",
    status: "Coming in Phase 1",
  },
  {
    title: "Subscription",
    description: "Manage your StrategemSignal subscription via Stripe. View invoices, update payment method, cancel.",
    status: "Coming with launch",
  },
  {
    title: "Audit Log",
    description: "Chronological record of every settings change for board-defense compliance. Required by the CEO traceability requirement.",
    status: "Coming in Phase 4",
  },
];

export default async function SettingsPage() {
  const session = await getSession();

  // Middleware already guarantees a session, but this is a belt-and-
  // suspenders check for type narrowing and clarity.
  if (!session) {
    redirect("/sign-in");
  }

  // Owner-only gate. Superadmin (env-var backstop) always passes.
  const isOwner = session.role === "owner" || session.isSuperadmin === true;

  // Look up the org name for display. The session carries orgSlug but not
  // the human name; one tiny query gets the rest.
  const [activeOrg] = await db.select().from(orgs).where(eq(orgs.id, session.orgId)).limit(1);

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1E293B]">Settings</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Configure your organization, manage members, and tune the platform.
        </p>
      </div>

      {/* Current session card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">
          Signed in as
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] text-[#6B7280] uppercase">User</p>
            <p className="text-sm font-medium text-[#1E293B]">{session.name ?? session.email}</p>
            <p className="text-[11px] text-[#6B7280]">{session.email}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#6B7280] uppercase">Active Organization</p>
            <p className="text-sm font-medium text-[#1E293B]">{activeOrg?.name ?? session.orgSlug}</p>
            <p className="text-[11px] text-[#6B7280]">
              Role: <span className="font-medium capitalize">{session.role.replace(/_/g, " ")}</span>
              {session.isSuperadmin && (
                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase bg-orange-100 text-[#EA580C]">
                  Superadmin
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {!isOwner ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-900">
          <p className="font-semibold">Settings is restricted to organization owners</p>
          <p className="text-sm mt-1">
            Your role in this organization is <strong className="capitalize">{session.role.replace(/_/g, " ")}</strong>.
            Contact your org owner if you need to change configuration.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {PLACEHOLDER_SECTIONS.map((section) => (
            <div
              key={section.title}
              className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-[#1E293B]">{section.title}</h3>
                <p className="text-[11px] text-[#6B7280] mt-1">{section.description}</p>
              </div>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-gray-100 text-[#6B7280] flex-shrink-0">
                {section.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
