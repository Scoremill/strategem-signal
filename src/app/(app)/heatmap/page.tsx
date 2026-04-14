/**
 * Portfolio Heatmap — the CEO's 10-second-read view.
 *
 * Mapbox choropleth of the user's tracked markets, colored green→red
 * by the composite Portfolio Health score at the user's chosen preset
 * weighting. Reads the latest portfolio_health_snapshots row for each
 * market and re-blends the three stored sub-scores client-side using
 * the user's preset (which lets Phase 1.3's weighting UI update the
 * heatmap without a pipeline re-run).
 *
 * If the user has no tracked markets selected, the heatmap defaults to
 * showing all 52 active MSAs so there's always something on screen.
 * An empty-state banner at the top prompts the user to pick their own
 * filter in /settings.
 */
import { getSession } from "@/lib/auth";
import { db, tenantQuery } from "@/lib/db";
import {
  geographies,
  trackedMarkets,
  healthScoreWeights,
  portfolioHealthSnapshots,
} from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import HeatmapClient, { type MarketHealthPoint } from "./HeatmapClient";
import { resolvePreset, type WeightPreset } from "@/lib/scoring/weight-presets";

export const dynamic = "force-dynamic";

export default async function HeatmapPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  // 1. Pull the user's tracked market filter.
  const t = tenantQuery(session.orgId);
  const tracked = (await t.select(
    trackedMarkets,
    eq(trackedMarkets.userId, session.userId)
  )) as Array<{ geographyId: string }>;
  const trackedIds = tracked.map((r) => r.geographyId);
  const isEmptyFilter = trackedIds.length === 0;

  // 2. Pull the user's weighting preset.
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

  // 3. Pull every active geography — always the full 52 so the map has
  //    context dots even when the filter is narrow.
  const allGeos = await db
    .select()
    .from(geographies)
    .where(eq(geographies.isActive, true));

  // 4. Pull the most recent snapshot row for each geography. We grab
  //    the latest row per geography (not a global latest date) because
  //    different markets may have been scored on different runs if a
  //    past run partially failed. Using a per-market MAX aligns with
  //    the pattern Drew has called out before.
  const snapshotRows = await db
    .select()
    .from(portfolioHealthSnapshots)
    .where(
      sql`(${portfolioHealthSnapshots.geographyId}, ${portfolioHealthSnapshots.snapshotDate}) IN (
        SELECT geography_id, MAX(snapshot_date)
        FROM portfolio_health_snapshots
        GROUP BY geography_id
      )`
    );
  const snapshotByGeo = new Map(snapshotRows.map((r) => [r.geographyId, r]));

  // 5. Shape the points for the client component. Composite is computed
  //    client-side from the three stored sub-scores using the user's
  //    preset, so a preset change doesn't require a re-fetch.
  const trackedSet = new Set(trackedIds);
  const marketPoints: MarketHealthPoint[] = allGeos.map((g) => {
    const snap = snapshotByGeo.get(g.id);
    return {
      id: g.id,
      shortName: g.shortName,
      state: g.state,
      lat: g.lat,
      lng: g.lng,
      isTracked: trackedSet.has(g.id),
      financial: snap?.financialScore != null ? parseFloat(String(snap.financialScore)) : null,
      demand: snap?.demandScore != null ? parseFloat(String(snap.demandScore)) : null,
      operational: snap?.operationalScore != null ? parseFloat(String(snap.operationalScore)) : null,
      snapshotDate: toYmd(snap?.snapshotDate),
    };
  });

  // Find the latest snapshot date across all markets so we can show it
  // as "Updated: 2026-04-14" in the header. Drizzle's date column comes
  // back as a Date or a YYYY-MM-DD string depending on driver version;
  // coerce to a consistent ISO YYYY-MM-DD string before comparing.
  function toYmd(v: unknown): string | null {
    if (v == null) return null;
    if (typeof v === "string") return v.slice(0, 10);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return null;
  }
  const latestSnapshotDate = snapshotRows.reduce<string | null>((latest, row) => {
    const ymd = toYmd(row.snapshotDate);
    if (!ymd) return latest;
    if (!latest || ymd > latest) return ymd;
    return latest;
  }, null);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-8 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-[#1E293B]">Portfolio Health View</h1>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {isEmptyFilter
                ? `All 52 markets · no personal filter set · ${preset.label} weighting`
                : `${trackedIds.length} tracked market${trackedIds.length === 1 ? "" : "s"} · ${preset.label} weighting`}
              {latestSnapshotDate && (
                <>
                  {" · "}
                  <span>Updated {latestSnapshotDate}</span>
                </>
              )}
            </p>
          </div>
          {isEmptyFilter && (
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
      <div className="flex-1 min-h-0">
        <HeatmapClient
          markets={marketPoints}
          preset={preset}
          showAllMarkets={isEmptyFilter}
        />
      </div>
    </div>
  );
}
