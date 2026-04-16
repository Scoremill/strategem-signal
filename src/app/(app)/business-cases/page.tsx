/**
 * Business Cases library — every case the user has saved against any
 * market, plus any cases peers have shared within the org.
 *
 * Two sections: "My cases" (this user's own) and "Shared by teammates"
 * (anything another user in the same org has toggled the share flag on).
 * Each card shows title, market, recommendation chip, key blended
 * numbers, notes, and a link back to the full business-case page with
 * the saved inputs re-applied (Phase 3.7 stores the inputs JSON on
 * the row; the link doesn't hydrate them yet — that's a small
 * follow-up, a "view saved" read-only mode).
 */
import { getSession } from "@/lib/auth";
import { db, tenantQuery } from "@/lib/db";
import { businessCases, geographies, users } from "@/lib/db/schema";
import { redirect } from "next/navigation";
import Link from "next/link";
import BusinessCaseListClient from "./BusinessCaseListClient";
import type {
  OrganicOutput,
  AcquisitionOutput,
} from "@/lib/business-case/types";

export const dynamic = "force-dynamic";

export interface SavedCaseRow {
  id: string;
  title: string;
  notes: string | null;
  geographyId: string;
  marketLabel: string;
  recommendation: string | null;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
  authorEmail: string | null;
  organic: OrganicOutput | null;
  acquisition: AcquisitionOutput | null;
  isMine: boolean;
}

export default async function BusinessCasesPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const t = tenantQuery(session.orgId);

  // All cases in the org — tenantQuery handles the org filter. We then
  // join the geography + author in a second pass to keep the tenant
  // query helper simple.
  const rows = (await t.select(businessCases)) as Array<{
    id: string;
    userId: string;
    geographyId: string;
    title: string;
    notes: string | null;
    organicOutputsJson: unknown;
    acquisitionOutputsJson: unknown;
    recommendation: string | null;
    shared: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;

  // Bulk-fetch all geographies and users so we can label each case.
  // Geographies is ~200 rows; users is <100 for the foreseeable future.
  // Cheaper than reducing to an inArray each render.
  const allGeos = rows.length > 0 ? await db.select().from(geographies) : [];
  const geoMap = new Map(
    allGeos.map((g) => [g.id, `${g.shortName}, ${g.state}`])
  );

  const allUsers = rows.length > 0 ? await db.select().from(users) : [];
  const userMap = new Map(
    allUsers.map((u) => [u.id, { name: u.name ?? null, email: u.email }])
  );

  const casesRaw: SavedCaseRow[] = rows.map((r) => {
    const author = userMap.get(r.userId);
    return {
      id: r.id,
      title: r.title,
      notes: r.notes,
      geographyId: r.geographyId,
      marketLabel: geoMap.get(r.geographyId) ?? "Unknown market",
      recommendation: r.recommendation,
      shared: r.shared,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      authorName: author?.name ?? null,
      authorEmail: author?.email ?? null,
      organic: (r.organicOutputsJson as OrganicOutput | null) ?? null,
      acquisition: (r.acquisitionOutputsJson as AcquisitionOutput | null) ?? null,
      isMine: r.userId === session.userId,
    };
  });

  // Split into my cases and shared-by-teammates. Non-shared cases by
  // other users are invisible to this user — enforced at read time.
  const mine = casesRaw
    .filter((c) => c.isMine)
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  const shared = casesRaw
    .filter((c) => !c.isMine && c.shared)
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E293B]">Business Cases</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Every scenario you&apos;ve saved, plus anything your teammates
          have shared with the org. Toggle a case to share it for peer
          review.
        </p>
      </div>

      <BusinessCaseListClient mine={mine} shared={shared} />

      {mine.length === 0 && shared.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="text-sm text-[#6B7280]">
            No saved business cases yet. Open any market and build a case
            using the Business Case button, then hit Save.
          </p>
          <Link
            href="/markets"
            className="inline-block mt-4 rounded-lg bg-[#F97316] hover:bg-[#EA580C] px-4 py-2 text-xs font-semibold text-white"
          >
            Browse markets
          </Link>
        </div>
      )}
    </div>
  );
}
