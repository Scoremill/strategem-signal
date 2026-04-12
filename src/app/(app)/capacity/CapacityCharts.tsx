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
  LabelList,
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
  demandIndex: number;
  status: string;
  tradeAvailability: number;
}

function getWageColor(wageYoy: number): string {
  if (wageYoy > 7) return "#DC2626";
  if (wageYoy > 5) return "#EF4444";
  if (wageYoy > 3) return "#D97706";
  return "#16A34A";
}

// Dot color reflects the market's own D/C Ratio status — independent of
// which quadrant it sits in. A market in the top-right (high demand, high
// trades) can still be amber if its trades are barely keeping pace with
// its demand.
function getStatusColor(status: string): string {
  if (status === "constrained") return "#DC2626"; // red
  if (status === "equilibrium") return "#D97706"; // amber
  return "#16A34A";                                // green (favorable)
}

export default function CapacityCharts({ markets }: { markets: CapacityMarket[] }) {
  // X-axis = raw trade workers in the market. Y-axis = blended Homebuilder
  // Demand Index (0-100). Quadrant lines cross at the VISUAL center of each
  // axis so the chart is split into 4 even quadrants.
  const maxWorkers = Math.max(...markets.map((m) => m.totalEmployment), 1);
  // Round up to a clean tick value so the center line lands on a round number.
  const xDomainMax = Math.ceil(maxWorkers / 50000) * 50000;
  const xCenter = xDomainMax / 2;
  const yCenter = 50; // Demand Index is already 0-100

  // Quadrant chart data — Trade Workers (x) vs Demand Index (y)
  const scatterData = markets.map((m) => ({
    x: m.totalEmployment,
    y: m.demandIndex,
    z: m.totalEstablishments,
    name: m.shortName,
    status: m.status,
    capacityIndex: m.capacityIndex,
    demandIndex: m.demandIndex,
    workers: m.totalEmployment,
    wageYoy: m.avgWageYoy,
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

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* Quadrant Chart — Trade Availability vs Homebuilder Demand */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-[#1E293B]">Trade Availability vs. Homebuilder Demand</h3>
          <p className="text-xs text-[#6B7280] mt-0.5">
            X = skilled labor supply (workers per permit, wage-adjusted). Y = blended demand index (permits, employment, migration, income, unemployment). Top-right = best markets.
          </p>
        </div>

        {/* Top row pills — high demand quadrants */}
        <div className="flex items-center justify-between mb-3 px-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-red-50 text-red-700 border border-red-200">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            Worst Markets · High demand, low trades
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-green-50 text-green-700 border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Best Markets · High demand, high trades
          </span>
        </div>

        <div className="flex items-center justify-center">
          <ResponsiveContainer width="100%" height={460}>
            <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                type="number"
                dataKey="x"
                name="Trade Workers"
                domain={[0, xDomainMax]}
                tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
                label={{ value: "Trade Availability (skilled labor supply) →", position: "insideBottom", offset: -10, style: { fontSize: 11, fill: "#6B7280" } }}
                stroke="#9CA3AF"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Homebuilder Demand"
                domain={[0, 100]}
                tickFormatter={(v) => `${v}`}
                label={{ value: "Homebuilder Demand (index 0-100) →", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#6B7280" } }}
                stroke="#9CA3AF"
                tick={{ fontSize: 11 }}
              />
              <ReferenceLine
                x={xCenter}
                stroke="#1E293B"
                strokeWidth={2}
              />
              <ReferenceLine
                y={yCenter}
                stroke="#1E293B"
                strokeWidth={2}
              />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                      <p className="font-semibold text-[#1E293B]">{d.name}</p>
                      <p className="text-[#6B7280]">Trade Workers: {d.workers?.toLocaleString()}</p>
                      <p className="text-[#6B7280]">Demand Index: {d.demandIndex}</p>
                      <p className="text-[#6B7280]">Capacity Index: {d.capacityIndex}</p>
                      <p className="text-[#6B7280]">Wage Growth: {d.wageYoy}%</p>
                    </div>
                  );
                }}
              />
              <Scatter data={scatterData}>
                {scatterData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={getStatusColor(entry.status)}
                    fillOpacity={0.85}
                    r={Math.max(8, Math.min(18, (entry.z || 1000) / 500))}
                  />
                ))}
                <LabelList
                  dataKey="name"
                  position="top"
                  offset={6}
                  style={{ fontSize: 10, fill: "#1E293B", fontWeight: 500, pointerEvents: "none" }}
                />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Bottom row pills — low demand quadrants */}
        <div className="flex items-center justify-between mt-3 px-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 border border-gray-300">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
            Low Opportunity · Low demand, low trades
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Untapped Capacity · Low demand, high trades
          </span>
        </div>
      </div>

      {/* Ranked Capacity Bar Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-[#1E293B]">Markets Ranked by Capacity Index</h3>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Higher score = more trade labor available. Bar color reflects wage pressure. Scroll within the chart to see all markets.
          </p>
        </div>
        {/* Fixed-height scroll container — matches the scatter chart height (400px)
            so the two visualizations sit balanced side-by-side. The inner chart
            preserves its full bar count by setting its own height. */}
        <div className="overflow-y-auto" style={{ height: 400 }}>
        <ResponsiveContainer width="100%" height={markets.length * 28 + 40}>
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
        </div>{/* /scroll container */}
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
