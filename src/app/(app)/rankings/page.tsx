/**
 * Portfolio Ranking Table.
 *
 * Sortable table of the user's tracked markets, one row per market,
 * showing the Composite score (blended at the user's preset weighting)
 * and the three sub-scores. Reads portfolio_health_snapshots with the
 * same per-market MAX(snapshot_date) pattern the heatmap uses.
 *
 * When the user has no tracked markets, falls back to all 52 active
 * MSAs with an empty-state banner linking to /settings. Same behavior
 * as /heatmap so navigation feels consistent.
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
import RankingTableClient, { type RankingRow } from "./RankingTableClient";
import { resolvePreset, type WeightPreset } from "@/lib/scoring/weight-presets";

export const dynamic = "force-dynamic";

function toYmd(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

export default async function RankingsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  // User's tracked filter
  const t = tenantQuery(session.orgId);
  const tracked = (await t.select(
    trackedMarkets,
    eq(trackedMarkets.userId, session.userId)
  )) as Array<{ geographyId: string }>;
  const trackedIds = new Set(tracked.map((r) => r.geographyId));
  const isEmptyFilter = trackedIds.size === 0;

  // Weighting preset
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

  // All active geographies
  const allGeos = await db
    .select()
    .from(geographies)
    .where(eq(geographies.isActive, true));

  // Latest snapshot row per geography
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

  // Build rows — when the filter is empty, include all 52; otherwise
  // only the tracked subset.
  const geosForRows = isEmptyFilter
    ? allGeos
    : allGeos.filter((g) => trackedIds.has(g.id));

  const rows: RankingRow[] = geosForRows.map((g) => {
    const snap = snapshotByGeo.get(g.id);
    return {
      id: g.id,
      shortName: g.shortName,
      state: g.state,
      financial:
        snap?.financialScore != null
          ? parseFloat(String(snap.financialScore))
          : null,
      demand:
        snap?.demandScore != null ? parseFloat(String(snap.demandScore)) : null,
      operational:
        snap?.operationalScore != null
          ? parseFloat(String(snap.operationalScore))
          : null,
      snapshotDate: toYmd(snap?.snapshotDate),
    };
  });

  const latestSnapshotDate = snapshotRows.reduce<string | null>((latest, row) => {
    const ymd = toYmd(row.snapshotDate);
    if (!ymd) return latest;
    if (!latest || ymd > latest) return ymd;
    return latest;
  }, null);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 sm:px-8 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-[#1E293B]">Portfolio Ranking</h1>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {isEmptyFilter
                ? `All 52 markets · no personal filter set · ${preset.label} weighting`
                : `${rows.length} tracked market${rows.length === 1 ? "" : "s"} · ${preset.label} weighting`}
              {latestSnapshotDate && <> · Updated {latestSnapshotDate}</>}
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
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-8">
        <RankingTableClient rows={rows} preset={preset} />
      </div>
    </div>
  );
}
