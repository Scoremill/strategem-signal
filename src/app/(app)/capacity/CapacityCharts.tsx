"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  BarChart,
  Bar,
  ReferenceLine,
} from "recharts";

interface CapacityMarket {
  id: string;
  shortName: string;
  totalEmployment: number;
  totalEstablishments: number;
  avgWeeklyWage: number;
  avgWageYoy: number;
  avgEmpYoy: number;
  capacityIndex: number;
  status: string;
}

function getStatusColor(status: string): string {
  if (status === "constrained") return "#DC2626";
  if (status === "equilibrium") return "#D97706";
  return "#16A34A";
}

function getWageColor(wageYoy: number): string {
  if (wageYoy > 7) return "#DC2626";
  if (wageYoy > 5) return "#EF4444";
  if (wageYoy > 3) return "#D97706";
  return "#16A34A";
}

export default function CapacityCharts({ markets }: { markets: CapacityMarket[] }) {
  // Quadrant chart data
  const scatterData = markets.map((m) => ({
    x: m.totalEmployment,
    y: m.avgWageYoy,
    z: m.totalEstablishments,
    name: m.shortName,
    status: m.status,
    capacityIndex: m.capacityIndex,
  }));

  // Ranked bar data — sorted by capacity index
  const rankedData = [...markets]
    .sort((a, b) => b.capacityIndex - a.capacityIndex)
    .map((m) => ({
      name: m.shortName,
      capacityIndex: m.capacityIndex,
      wageYoy: m.avgWageYoy,
      status: m.status,
    }));

  const avgCapacity = markets.reduce((s, m) => s + m.capacityIndex, 0) / (markets.length || 1);
  const avgWage = markets.reduce((s, m) => s + m.avgWageYoy, 0) / (markets.length || 1);
  const avgWorkers = markets.reduce((s, m) => s + m.totalEmployment, 0) / (markets.length || 1);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* Quadrant Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-[#1E293B]">Capacity vs. Cost Pressure</h3>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Bottom-right = strong capacity, low cost pressure (deploy capital). Top-left = tight labor, rising costs (caution).
          </p>
        </div>

        {/* Quadrant labels */}
        <div className="relative">
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                type="number"
                dataKey="x"
                name="Trade Workers"
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
                label={{ value: "Trade Workers →", position: "insideBottom", offset: -10, style: { fontSize: 11, fill: "#6B7280" } }}
                stroke="#9CA3AF"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Wage Growth YoY"
                tickFormatter={(v) => `${v}%`}
                label={{ value: "Wage Growth YoY →", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#6B7280" } }}
                stroke="#9CA3AF"
                tick={{ fontSize: 11 }}
              />
              <ReferenceLine x={avgWorkers} stroke="#D1D5DB" strokeDasharray="5 5" />
              <ReferenceLine y={avgWage} stroke="#D1D5DB" strokeDasharray="5 5" />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                      <p className="font-semibold text-[#1E293B]">{d.name}</p>
                      <p className="text-[#6B7280]">Workers: {d.x.toLocaleString()}</p>
                      <p className="text-[#6B7280]">Wage Growth: {d.y}%</p>
                      <p className="text-[#6B7280]">Capacity Index: {d.capacityIndex}</p>
                    </div>
                  );
                }}
              />
              <Scatter data={scatterData}>
                {scatterData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={getStatusColor(entry.status)}
                    fillOpacity={0.8}
                    r={Math.max(8, Math.min(20, (entry.z || 1000) / 500))}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>

          {/* Quadrant annotations */}
          <div className="absolute top-6 left-16 text-[10px] font-semibold text-red-400 uppercase tracking-wider">
            Tight & Expensive
          </div>
          <div className="absolute top-6 right-10 text-[10px] font-semibold text-amber-500 uppercase tracking-wider">
            Large but Costly
          </div>
          <div className="absolute bottom-8 left-16 text-[10px] font-semibold text-amber-500 uppercase tracking-wider">
            Small but Affordable
          </div>
          <div className="absolute bottom-8 right-10 text-[10px] font-semibold text-green-600 uppercase tracking-wider">
            Favorable For Capital Deployment
          </div>
        </div>
      </div>

      {/* Ranked Capacity Bar Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-[#1E293B]">Markets Ranked by Capacity Index</h3>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Higher score = more trade labor available. Bar color reflects wage pressure.
          </p>
        </div>
        <ResponsiveContainer width="100%" height={markets.length * 36 + 40}>
          <BarChart
            data={rankedData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#9CA3AF" />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 12, fill: "#1E293B" }}
              width={75}
            />
            <ReferenceLine x={avgCapacity} stroke="#6B7280" strokeDasharray="5 5" label={{ value: "Avg", position: "top", style: { fontSize: 10, fill: "#6B7280" } }} />
            <Tooltip
              content={({ payload }) => {
                if (!payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                    <p className="font-semibold text-[#1E293B]">{d.name}</p>
                    <p className="text-[#6B7280]">Capacity Index: {d.capacityIndex}</p>
                    <p className="text-[#6B7280]">Wage Growth: {d.wageYoy}%</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="capacityIndex" radius={[0, 4, 4, 0]}>
              {rankedData.map((entry, i) => (
                <Cell key={i} fill={getWageColor(entry.wageYoy)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-3 text-xs text-[#6B7280] border-t border-gray-100 pt-3">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#16A34A]" /> Wage &lt;3%</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#D97706]" /> Wage 3–5%</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#EF4444]" /> Wage 5–7%</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#DC2626]" /> Wage &gt;7%</span>
        </div>
      </div>
      </div>
    </div>
  );
}
