/**
 * Markets — unified Portfolio Health + Market Opportunity page.
 *
 * Replaces the prior /rankings and /opportunities screens. A two-pill
 * switcher at the top flips between:
 *
 *   - Portfolio Health View: composite + 3 sub-scores from Phase 1,
 *     blended at the user's weighting preset, for the user's tracked
 *     markets. Sorted by composite DESC.
 *
 *   - Market Opportunity View: six filter scores from Phase 2 for the
 *     same tracked markets. Sorted by num_green DESC.
 *
 * Both perspectives are filtered to the user's "My Markets" list. The
 * settings page is the single funnel for deciding which markets matter;
 * this screen scores them from the two analytical lenses. At 380 MSAs
 * the raw scan would be unusable, so the filter funnel is essential.
 *
 * Cells are colored as an Excel-style heatmap (red → amber → green)
 * using the shared heatmap-color scale so this page, the /heatmap
 * choropleth, and the per-market drilldown agree visually.
 */
import { getSession } from "@/lib/auth";
import { db, tenantQuery } from "@/lib/db";
import {
  geographies,
  trackedMarkets,
  healthScoreWeights,
  portfolioHealthSnapshots,
  marketOpportunityScores,
  watchlistMarkets,
} from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import MarketsTableClient, {
  type MarketRow,
} from "./MarketsTableClient";
import { resolvePreset, type WeightPreset } from "@/lib/scoring/weight-presets";

export const dynamic = "force-dynamic";

function toYmd(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

export default async function MarketsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  // 1. User's tracked filter — the single funnel for what to show.
  const t = tenantQuery(session.orgId);
  const tracked = (await t.select(
    trackedMarkets,
    eq(trackedMarkets.userId, session.userId)
  )) as Array<{ geographyId: string }>;
  const trackedIds = new Set(tracked.map((r) => r.geographyId));

  // 2. Weighting preset (for Portfolio Health composite blend).
  const [weightRow] = await db
    .select()
    .from(healthScoreWeights)
    .where(
      and(
        eq(healthScoreWeights.userId, session.userId),
        eq(healthScoreWeights.orgId, session.orgId)
      )
    )
    .limit(1);
  const preset: WeightPreset = resolvePreset(weightRow?.presetName);

  // 3. All active geographies — we'll filter client-side to the
  //    tracked set, but we pull the full 52 so we can display the
  //    empty-state banner with an accurate total.
  const allGeos = await db
    .select()
    .from(geographies)
    .where(eq(geographies.isActive, true));

  // 4. Latest Portfolio Health snapshot per geography.
  const healthRows = await db
    .select()
    .from(portfolioHealthSnapshots)
    .where(
      sql`(${portfolioHealthSnapshots.geographyId}, ${portfolioHealthSnapshots.snapshotDate}) IN (
        SELECT geography_id, MAX(snapshot_date)
        FROM portfolio_health_snapshots
        GROUP BY geography_id
      )`
    );
  const healthByGeo = new Map(healthRows.map((r) => [r.geographyId, r]));

  // 5. Latest Market Opportunity snapshot per geography.
  const oppRows = await db
    .select()
    .from(marketOpportunityScores)
    .where(
      sql`(${marketOpportunityScores.geographyId}, ${marketOpportunityScores.snapshotDate}) IN (
        SELECT geography_id, MAX(snapshot_date)
        FROM market_opportunity_scores
        GROUP BY geography_id
      )`
    );
  const oppByGeo = new Map(oppRows.map((r) => [r.geographyId, r]));

  // 6. User's watchlist (for the star button on the Opportunity perspective).
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

  // 7. Build rows — filter to tracked markets unless empty, in which
  //    case we show nothing and surface a "pick markets" prompt.
  const targetGeos = trackedIds.size > 0
    ? allGeos.filter((g) => trackedIds.has(g.id))
    : [];

  const rows: MarketRow[] = targetGeos.map((g) => {
    const h = healthByGeo.get(g.id);
    const o = oppByGeo.get(g.id);
    return {
      id: g.id,
      shortName: g.shortName,
      state: g.state,
      // Portfolio Health
      financial: h?.financialScore != null ? parseFloat(String(h.financialScore)) : null,
      demand: h?.demandScore != null ? parseFloat(String(h.demandScore)) : null,
      operational: h?.operationalScore != null ? parseFloat(String(h.operationalScore)) : null,
      // Market Opportunity
      filter1: o?.filter1Migration != null ? parseFloat(String(o.filter1Migration)) : null,
      filter2: o?.filter2Diversity != null ? parseFloat(String(o.filter2Diversity)) : null,
      filter3: o?.filter3Imbalance != null ? parseFloat(String(o.filter3Imbalance)) : null,
      filter4: o?.filter4Competitive != null ? parseFloat(String(o.filter4Competitive)) : null,
      filter5: o?.filter5Affordability != null ? parseFloat(String(o.filter5Affordability)) : null,
      filter6: o?.filter6Operational != null ? parseFloat(String(o.filter6Operational)) : null,
      numGreen: o?.numGreen ?? 0,
      onWatchlist: watchlistSet.has(g.id),
      snapshotDate: toYmd(h?.snapshotDate) ?? toYmd(o?.snapshotDate),
    };
  });

  // Pick the freshest snapshot date across both tables for the header.
  const latestSnapshotDate = rows.reduce<string | null>((latest, r) => {
    if (!r.snapshotDate) return latest;
    if (!latest || r.snapshotDate > latest) return r.snapshotDate;
    return latest;
  }, null);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 sm:px-8 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-[#1E293B]">Markets</h1>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {trackedIds.size > 0
                ? `${rows.length} tracked market${rows.length === 1 ? "" : "s"} \u00b7 ${preset.label} weighting`
                : "No personal filter set"}
              {latestSnapshotDate && <> · Updated {latestSnapshotDate}</>}
            </p>
          </div>
          {trackedIds.size === 0 && (
            <a
              href="/settings"
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F97316] hover:bg-[#EA580C] text-white text-xs font-semibold transition-colors"
            >
              Pick markets
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-8">
        {rows.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-sm text-[#6B7280]">
              Pick markets in Settings to see them scored here across both the
              Portfolio Health and Market Opportunity lenses.
            </p>
          </div>
        ) : (
          <MarketsTableClient rows={rows} preset={preset} />
        )}
      </div>
    </div>
  );
}
