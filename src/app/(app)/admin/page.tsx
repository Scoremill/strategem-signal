/**
 * Admin placeholder.
 *
 * The v1 admin page exposed manual triggers for the demand/capacity/scoring/
 * narratives pipelines plus a CSV export. Several of those pipelines were
 * removed in the v2 wipe (composite scoring, narratives, the old export
 * shape) and the surviving federal pipelines are still triggered by the
 * GitHub Actions cron workflows.
 *
 * Phase 0.13 rebuilds this surface as the multi-tenant org settings UI:
 *   - Org details, logo, members, role assignment
 *   - Tracked market list (which MSAs the org watches)
 *   - Health score weighting (Financial / Demand / Operational sliders)
 *   - Stripe subscription management
 *   - Snapshot freshness indicator (StrategemOps mirror health)
 */
export const dynamic = "force-dynamic";

export default function AdminPlaceholder() {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-[#1E293B]">Admin</h1>
        <p className="mt-3 text-sm text-[#6B7280]">
          The admin surface is being rebuilt as the multi-tenant org settings
          UI in Phase 0.13. Federal data pipelines continue to refresh on
          their GitHub Actions cron schedules in the meantime.
        </p>
      </div>
    </div>
  );
}
