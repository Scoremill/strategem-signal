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
  ReferenceArea,
  LabelList,
} from "recharts";
import {
  QUADRANT_MARKETS,
  LABELED_MARKETS,
  QUADRANT_COLORS,
} from "@/lib/quadrant-data";

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

// Quadrant chart data is the curated 50-SMA dataset. The chart is a research
// framework, not a derivation from our DB. See src/lib/quadrant-data.ts.
const QUADRANT_SCATTER = QUADRANT_MARKETS.map((m) => ({
  x: m.trades,
  y: m.demand,
  name: m.name,
  state: m.state,
  rating: m.rating,
  note: m.note,
  quadrant: m.quadrant,
  showLabel: LABELED_MARKETS.has(m.name),
}));

export default function CapacityCharts({ markets }: { markets: CapacityMarket[] }) {

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
      {/* Quadrant Chart — Trade Availability vs Homebuilder Demand
          Curated research framework dataset (50 SMAs). See lib/quadrant-data.ts. */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-[#1E293B]">Trade Availability vs. Homebuilder Demand</h3>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Where can a homebuilder deploy capital and actually staff the work? Top-right = best markets. Top-left = high demand the trades can&apos;t keep up with.
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
          <ResponsiveContainer width="100%" height={520}>
            <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 30 }}>
              {/* Quadrant background tints (per spec section 5.2) */}
              <ReferenceArea x1={10} x2={50} y1={50} y2={90} fill="#DC2626" fillOpacity={0.05} stroke="none" />
              <ReferenceArea x1={50} x2={80} y1={50} y2={90} fill="#16A34A" fillOpacity={0.05} stroke="none" />
              <ReferenceArea x1={10} x2={50} y1={15} y2={50} fill="#DC2626" fillOpacity={0.03} stroke="none" />
              <ReferenceArea x1={50} x2={80} y1={15} y2={50} fill="#D97706" fillOpacity={0.04} stroke="none" />

              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                type="number"
                dataKey="x"
                name="Trade Availability"
                domain={[10, 80]}
                ticks={[10, 20, 30, 40, 50, 60, 70, 80]}
                label={{ value: "Trade availability (skilled labor supply) →", position: "insideBottom", offset: -15, style: { fontSize: 11, fill: "#6B7280" } }}
                stroke="#9CA3AF"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Homebuilder Demand"
                domain={[15, 90]}
                ticks={[15, 30, 45, 60, 75, 90]}
                label={{ value: "Homebuilder demand (starts & permits) →", angle: -90, position: "insideLeft", offset: 5, style: { fontSize: 11, fill: "#6B7280" } }}
                stroke="#9CA3AF"
                tick={{ fontSize: 11 }}
              />

              {/* Crosshair midpoints at 50/50 */}
              <ReferenceLine x={50} stroke="#1E293B" strokeWidth={1.5} strokeDasharray="6 4" />
              <ReferenceLine y={50} stroke="#1E293B" strokeWidth={1.5} strokeDasharray="6 4" />

              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0].payload;
                  const ratingColor =
                    d.rating === "Green" ? "#2d9d4f" : d.rating === "Red" ? "#c83a3a" : "#d4920a";
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs max-w-[240px]">
                      <p className="font-semibold text-[#1E293B] text-[13px]">{d.name}, {d.state}</p>
                      <p className="text-[#6B7280] mt-0.5">{d.note}</p>
                      <p className="mt-1 font-semibold" style={{ color: ratingColor }}>
                        {d.rating === "Green" ? "Good" : d.rating === "Red" ? "Bad" : "Balanced"}
                      </p>
                      <p className="text-[10px] text-[#9CA3AF] mt-0.5">
                        Demand {d.y} · Trades {d.x}
                      </p>
                    </div>
                  );
                }}
              />

              <Scatter data={QUADRANT_SCATTER} isAnimationActive={false}>
                {QUADRANT_SCATTER.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={QUADRANT_COLORS[entry.rating]}
                    fillOpacity={0.85}
                    stroke={QUADRANT_COLORS[entry.rating]}
                    strokeOpacity={0.25}
                    strokeWidth={3}
                    r={6.5}
                  />
                ))}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <LabelList
                  dataKey="name"
                  content={(props: any) => {
                    const { x, y, value } = props;
                    const cx = typeof x === "number" ? x : parseFloat(x ?? "0");
                    const cy = typeof y === "number" ? y : parseFloat(y ?? "0");
                    return (
                      <text
                        x={cx}
                        y={cy - 10}
                        fill="#1E293B"
                        fontSize={9}
                        fontWeight={500}
                        textAnchor="middle"
                        style={{ pointerEvents: "none" } as React.CSSProperties}
                      >
                        {value}
                      </text>
                    );
                  }}
                />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Bottom row pills — low demand quadrants */}
        <div className="flex items-center justify-between mt-3 px-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-red-50 text-red-700 border border-red-200">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            Low Opportunity · Low demand, low trades
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Untapped Capacity · Low demand, high trades
          </span>
        </div>

        {/* Legend (per spec section 5.6) */}
        <div className="flex items-center justify-center gap-6 mt-4 pt-3 border-t border-gray-100 text-[11px] text-[#6B7280]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ background: QUADRANT_COLORS.Green }} />
            Good — demand met by available trades
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ background: QUADRANT_COLORS.Amber }} />
            Balanced — workable but watch closely
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ background: QUADRANT_COLORS.Red }} />
            Bad — demand outstrips trade capacity
          </span>
        </div>

        <p className="text-[10px] text-[#9CA3AF] mt-3 text-center italic">
          Directional strategic framework. Sources: Census Building Permits, BLS QCEW &amp; OEWS, NAHB HMI, RCLCO Top 50 MPC, Builder 100, ABC/AGC workforce surveys, HBI labor reports. Refresh quarterly.
        </p>
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
