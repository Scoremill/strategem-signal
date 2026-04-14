/**
 * Market Opportunity screen — the "Find New Markets" view.
 *
 * Sortable table of every active MSA scored on the six independent
 * filters from CEO requirement section 2.2. Default sort is num_green
 * DESC so the markets passing the most filters land at the top.
 *
 * Not user-filtered (unlike /rankings): this screen is the scan of
 * the whole universe, not your personal portfolio. The watchlist
 * button on each row (Phase 2.11) lets you flag a market for ongoing
 * monitoring without adding it to your tracked_markets filter.
 *
 * Two of the six filters are stubbed in the initial Phase 2 ship:
 * Filter 4 (Competitive Landscape) needs a builder→market mapping we
 * don't have, and Filter 5 (Affordability Runway) needs the FHFA
 * House Price Index pipeline that's deferred. They render as "—" in
 * the table with an asterisk footnote.
 */
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  geographies,
  marketOpportunityScores,
  watchlistMarkets,
} from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import OpportunitiesTableClient, {
  type OpportunityRow,
} from "./OpportunitiesTableClient";

export const dynamic = "force-dynamic";

function toYmd(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

export default async function OpportunitiesPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  // All active geographies
  const allGeos = await db
    .select()
    .from(geographies)
    .where(eq(geographies.isActive, true));

  // Latest opportunity snapshot per geography
  const snapshotRows = await db
    .select()
    .from(marketOpportunityScores)
    .where(
      sql`(${marketOpportunityScores.geographyId}, ${marketOpportunityScores.snapshotDate}) IN (
        SELECT geography_id, MAX(snapshot_date)
        FROM market_opportunity_scores
        GROUP BY geography_id
      )`
    );
  const snapshotByGeo = new Map(snapshotRows.map((r) => [r.geographyId, r]));

  // User's watchlist — the button on each row toggles membership here
  const watchlistRows = await db
    .select()
    .from(watchlistMarkets)
    .where(
      and(
        eq(watchlistMarkets.orgId, session.orgId),
        eq(watchlistMarkets.userId, session.userId)
      )
    );
  const watchlistSet = new Set(watchlistRows.map((r) => r.geographyId));

  const rows: OpportunityRow[] = allGeos.map((g) => {
    const snap = snapshotByGeo.get(g.id);
    return {
      id: g.id,
      shortName: g.shortName,
      state: g.state,
      filter1: snap?.filter1Migration != null ? parseFloat(String(snap.filter1Migration)) : null,
      filter2: snap?.filter2Diversity != null ? parseFloat(String(snap.filter2Diversity)) : null,
      filter3: snap?.filter3Imbalance != null ? parseFloat(String(snap.filter3Imbalance)) : null,
      filter4: snap?.filter4Competitive != null ? parseFloat(String(snap.filter4Competitive)) : null,
      filter5: snap?.filter5Affordability != null ? parseFloat(String(snap.filter5Affordability)) : null,
      filter6: snap?.filter6Operational != null ? parseFloat(String(snap.filter6Operational)) : null,
      numGreen: snap?.numGreen ?? 0,
      snapshotDate: toYmd(snap?.snapshotDate),
      onWatchlist: watchlistSet.has(g.id),
    };
  });

  const latestSnapshotDate = snapshotRows.reduce<string | null>((latest, row) => {
    const ymd = toYmd(row.snapshotDate);
    if (!ymd) return latest;
    if (!latest || ymd > latest) return ymd;
    return latest;
  }, null);

  const totalGreen3Plus = rows.filter((r) => r.numGreen >= 3).length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 sm:px-8 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-[#1E293B]">Market Opportunity</h1>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {rows.length} markets scanned · {totalGreen3Plus} with 3+ filters green
              {latestSnapshotDate && <> · Updated {latestSnapshotDate}</>}
            </p>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-8">
        <OpportunitiesTableClient rows={rows} />
      </div>
    </div>
  );
}
