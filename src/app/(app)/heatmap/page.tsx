export default function HeatmapPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#1E293B]">Demand-Capacity Heatmap</h1>
      <p className="text-sm text-[#6B7280] mt-1">
        Geographic view of demand-capacity ratios across monitored markets
      </p>
      <div className="mt-8 bg-white rounded-xl border border-gray-200 h-[600px] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#6B7280] text-lg">Mapbox GL heatmap</p>
          <p className="text-sm text-[#9CA3AF] mt-1">Requires Mapbox token — Phase 5</p>
        </div>
      </div>
    </div>
  );
}
