"use client";

import { useEffect, useState } from "react";

interface TopPick {
  market: string;
  reason: string;
  ratio: number;
  caution: string;
}

interface WatchItem {
  market: string;
  concern: string;
}

interface PortfolioData {
  summary: string;
  topPicks: TopPick[];
  watchList: WatchItem[];
}

export default function PortfolioIntelligence() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/portfolio-narrative", { credentials: "same-origin" });
        if (res.ok) {
          const d = await res.json();
          if (d.summary) setData(d);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="bg-[#FFF7ED] rounded-xl border border-[#F97316]/20 p-6 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-5 h-5 bg-[#F97316] rounded-full flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-[#EA580C]">Strategem Market Intelligence</p>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-3 bg-[#F97316]/10 rounded w-full" />
          <div className="h-3 bg-[#F97316]/10 rounded w-5/6" />
          <div className="h-3 bg-[#F97316]/10 rounded w-4/6" />
          <div className="h-3 bg-[#F97316]/10 rounded w-full" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mb-8 space-y-4">
      {/* Executive Summary */}
      <div className="bg-[#FFF7ED] rounded-xl border border-[#F97316]/20 p-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 bg-[#F97316] rounded-full flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-[#EA580C]">Strategem Market Intelligence</p>
        </div>
        <p className="text-sm text-[#1E293B] leading-relaxed">{data.summary}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Picks — fixed-height scroll keeps both cards balanced */}
        <div className="bg-white rounded-xl border border-green-200 overflow-hidden flex flex-col" style={{ height: 520 }}>
          <div className="px-5 py-3 bg-green-50 border-b border-green-200 flex-shrink-0">
            <h3 className="text-sm font-semibold text-green-800">Top Markets for Capital Deployment</h3>
          </div>
          <div className="divide-y divide-gray-100 overflow-y-auto flex-1">
            {data.topPicks.slice(0, 10).map((pick, i) => (
              <div key={i} className="px-5 py-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-[#1E293B] text-sm">{pick.market}</span>
                  <span className="text-xs font-bold text-green-700">Ratio: {pick.ratio.toFixed(2)}</span>
                </div>
                <p className="text-xs text-[#4B5563] leading-relaxed">{pick.reason}</p>
                <p className="text-[10px] text-amber-700 mt-1 italic">Watch: {pick.caution}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Watch List — fixed-height scroll keeps both cards balanced */}
        <div className="bg-white rounded-xl border border-red-200 overflow-hidden flex flex-col" style={{ height: 520 }}>
          <div className="px-5 py-3 bg-red-50 border-b border-red-200 flex-shrink-0">
            <h3 className="text-sm font-semibold text-red-800">Markets to Watch — Capacity Risk</h3>
          </div>
          <div className="divide-y divide-gray-100 overflow-y-auto flex-1">
            {data.watchList.slice(0, 10).map((item, i) => (
              <div key={i} className="px-5 py-4">
                <span className="font-semibold text-[#1E293B] text-sm">{item.market}</span>
                <p className="text-xs text-[#4B5563] leading-relaxed mt-1">{item.concern}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
