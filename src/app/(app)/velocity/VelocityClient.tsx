"use client";

import { useState } from "react";

interface MarketData {
  id: string;
  shortName: string;
  state: string;
  demandIndex: number;
  capacityIndex: number;
  ratio: number;
  status: string;
  permits: number | null;
  employment: number | null;
  unemploymentRate: number | null;
  tradeWorkers: number | null;
  wageGrowthYoy: number | null;
  establishments: number | null;
}

const STATUS_LABEL: Record<string, string> = {
  constrained: "Constrained",
  equilibrium: "Balanced",
  favorable: "Favorable",
};

const STATUS_COLOR: Record<string, string> = {
  constrained: "text-red-700",
  equilibrium: "text-amber-700",
  favorable: "text-green-700",
};

const STATUS_BG: Record<string, string> = {
  constrained: "bg-red-100 text-red-800",
  equilibrium: "bg-amber-100 text-amber-800",
  favorable: "bg-green-100 text-green-800",
};

function MetricBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[#6B7280] w-28 text-right">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2.5">
        <div className={`h-2.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-[#1E293B] w-12">{value}</span>
    </div>
  );
}

export default function VelocityClient({ markets }: { markets: MarketData[] }) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggleMarket(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : prev.length < 4 ? [...prev, id] : prev
    );
  }

  const selectedMarkets = markets.filter((m) => selected.includes(m.id));

  // Compute gap (demand - capacity) for ranking
  const ranked = [...markets]
    .map((m) => ({ ...m, gap: m.demandIndex - m.capacityIndex }))
    .sort((a, b) => b.gap - a.gap);

  const maxPermits = Math.max(...markets.map((m) => m.permits ?? 0), 1);
  const maxWorkers = Math.max(...markets.map((m) => m.tradeWorkers ?? 0), 1);

  return (
    <div className="space-y-8">
      {/* Market Comparison Tool */}
      <div>
        <h2 className="text-lg font-bold text-[#1E293B] mb-1">Market Comparison</h2>
        <p className="text-sm text-[#6B7280] mb-4">
          Select up to 4 markets to compare side-by-side across all metrics.
        </p>

        {/* Market selector */}
        <div className="flex flex-wrap gap-2 mb-6">
          {markets.map((m) => (
            <button
              key={m.id}
              onClick={() => toggleMarket(m.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                selected.includes(m.id)
                  ? "bg-[#F97316] text-white border-[#F97316]"
                  : "bg-white text-[#4B5563] border-gray-200 hover:border-[#F97316]"
              }`}
            >
              {m.shortName}
            </button>
          ))}
        </div>

        {/* Comparison cards */}
        {selectedMarkets.length > 0 ? (
          <div className={`grid gap-4 ${selectedMarkets.length === 1 ? "grid-cols-1 max-w-md" : selectedMarkets.length === 2 ? "grid-cols-2" : selectedMarkets.length === 3 ? "grid-cols-3" : "grid-cols-2 lg:grid-cols-4"}`}>
            {selectedMarkets.map((m) => (
              <div key={m.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-[#1E293B]">{m.shortName}</h3>
                    <span className="text-xs text-[#6B7280]">{m.state}</span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BG[m.status]}`}>
                    {STATUS_LABEL[m.status]}
                  </span>
                </div>

                {/* Ratio */}
                <div className="text-center mb-4 pb-4 border-b border-gray-100">
                  <p className="text-xs text-[#6B7280] uppercase tracking-wider font-semibold">D/C Ratio</p>
                  <p className={`text-3xl font-bold ${STATUS_COLOR[m.status]}`}>{m.ratio.toFixed(2)}</p>
                </div>

                {/* Indices */}
                <div className="space-y-2 mb-4">
                  <MetricBar label="Demand" value={m.demandIndex} max={100} color="bg-blue-500" />
                  <MetricBar label="Capacity" value={m.capacityIndex} max={100} color="bg-emerald-500" />
                </div>

                {/* Details */}
                <div className="space-y-1.5 text-xs border-t border-gray-100 pt-3">
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Permits/Mo</span>
                    <span className="font-medium text-[#1E293B]">{m.permits?.toLocaleString() ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Employment</span>
                    <span className="font-medium text-[#1E293B]">{m.employment ? (m.employment / 1000).toFixed(0) + "K" : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Unemployment</span>
                    <span className="font-medium text-[#1E293B]">{m.unemploymentRate ? m.unemploymentRate + "%" : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Trade Workers</span>
                    <span className="font-medium text-[#1E293B]">{m.tradeWorkers?.toLocaleString() ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Wage Growth YoY</span>
                    <span className={`font-medium ${(m.wageGrowthYoy ?? 0) > 5 ? "text-red-600" : "text-green-600"}`}>
                      {m.wageGrowthYoy ? `${m.wageGrowthYoy > 0 ? "+" : ""}${m.wageGrowthYoy}%` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Establishments</span>
                    <span className="font-medium text-[#1E293B]">{m.establishments?.toLocaleString() ?? "—"}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-[#6B7280]">Select markets above to compare</p>
          </div>
        )}
      </div>

      {/* Demand-Capacity Gap Ranking */}
      <div>
        <h2 className="text-lg font-bold text-[#1E293B] mb-1">Demand-Capacity Gap</h2>
        <p className="text-sm text-[#6B7280] mb-4">
          Markets ranked by the gap between demand strength and available capacity. Positive gap = demand outrunning capacity.
        </p>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-100">
            {ranked.map((m) => {
              const isPositive = m.gap > 0;
              return (
                <div key={m.id} className="px-5 py-3 flex items-center gap-4">
                  <div className="w-40">
                    <span className="font-medium text-[#1E293B] text-sm">{m.shortName}</span>
                    <span className="text-xs text-[#6B7280] ml-1">{m.state}</span>
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 relative h-6 bg-gray-50 rounded overflow-hidden">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-gray-300" />
                      {isPositive ? (
                        <div
                          className="absolute inset-y-0 left-1/2 bg-red-200 rounded-r"
                          style={{ width: `${Math.min(50, Math.abs(m.gap) / 2)}%` }}
                        />
                      ) : (
                        <div
                          className="absolute inset-y-0 bg-green-200 rounded-l"
                          style={{ width: `${Math.min(50, Math.abs(m.gap) / 2)}%`, right: "50%" }}
                        />
                      )}
                    </div>
                  </div>
                  <div className="w-20 text-right">
                    <span className={`text-sm font-bold ${isPositive ? "text-red-700" : "text-green-700"}`}>
                      {isPositive ? "+" : ""}{m.gap}
                    </span>
                  </div>
                  <div className="w-16 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BG[m.status]}`}>
                      {STATUS_LABEL[m.status]}
                    </span>
                  </div>
                  <div className="w-24 text-right text-xs text-[#6B7280]">
                    D:{m.demandIndex} C:{m.capacityIndex}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
