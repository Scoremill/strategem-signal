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
  tradeAvailability: number;
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
  // Quadrant chart data — Trade Availability (x) vs Wage Pressure (y)
  const scatterData = markets.map((m) => ({
    x: m.tradeAvailability,
    y: m.avgWageYoy,
    z: m.totalEstablishments,
    name: m.shortName,
    status: m.status,
    capacityIndex: m.capacityIndex,
    workers: m.totalEmployment,
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
  const avgAvailability = markets.reduce((s, m) => s + m.tradeAvailability, 0) / (markets.length || 1);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* Quadrant Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-[#1E293B]">Trade Availability vs. Cost Pressure</h3>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Trade Availability = workers per permit, adjusted for wage pressure. Higher = more trades available per unit of demand.
          </p>
        </div>

        {/* Quadrant pill legend — outside the chart */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <span className="inline-flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-red-50 text-red-700 border border-red-200">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            Top Left: Tight & Expensive
          </span>
          <span className="inline-flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Top Right: Large but Costly
          </span>
          <span className="inline-flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Bottom Left: Small but Affordable
          </span>
          <span className="inline-flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-green-50 text-green-700 border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Bottom Right: Favorable For Capital Deployment
          </span>
        </div>

        <div className="flex items-center justify-center">
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                type="number"
                dataKey="x"
                name="Trade Availability"
                tickFormatter={(v) => v.toFixed(0)}
                label={{ value: "Trade Availability →", position: "insideBottom", offset: -10, style: { fontSize: 11, fill: "#6B7280" } }}
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
              <ReferenceLine x={avgAvailability} stroke="#D1D5DB" strokeDasharray="5 5" />
              <ReferenceLine y={avgWage} stroke="#D1D5DB" strokeDasharray="5 5" />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                      <p className="font-semibold text-[#1E293B]">{d.name}</p>
                      <p className="text-[#6B7280]">Trade Availability: {d.x.toFixed(1)}</p>
                      <p className="text-[#6B7280]">Trade Workers: {d.workers?.toLocaleString()}</p>
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
        <div className="flex items-center justify-center">
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
        </div>
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
