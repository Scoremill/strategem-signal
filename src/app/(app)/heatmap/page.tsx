/**
 * Heatmap placeholder.
 *
 * The v1 heatmap rendered a Mapbox choropleth colored by the composite
 * Demand-Capacity Ratio (a metric that no longer exists under v2). Phase 1
 * of the v2 rebuild repurposes this route as the Portfolio Health View map
 * with the org's tracked markets colored by the org-weighted health score.
 *
 * Until then this page simply tells the user where they are. Mapbox setup,
 * marker rendering, and click-to-drilldown will be reintroduced in Phase 1.
 */
export const dynamic = "force-dynamic";

export default function HeatmapPlaceholder() {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-[#1E293B]">Portfolio Heatmap</h1>
        <p className="mt-3 text-sm text-[#6B7280]">
          The Portfolio Health View is being rebuilt as part of the v2 CEO
          platform. It will return in Phase 1, color-coded by your
          organization&apos;s blended health score across tracked markets.
        </p>
      </div>
    </div>
  );
}
