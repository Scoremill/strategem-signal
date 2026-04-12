"use client";

import { useEffect, useState } from "react";

interface TopPick {
  market: string;
  reason: string;
  ratio: number;
  caution: string;
}

export default function TopPicksPanel() {
  const [picks, setPicks] = useState<TopPick[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/portfolio-narrative", { credentials: "same-origin" });
        if (res.ok) {
          const d = await res.json();
          if (d.topPicks?.length) setPicks(d.topPicks);
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
      <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#EA580C] mb-3">Top Picks</p>
        <div className="animate-pulse space-y-3">
          <div className="h-12 bg-gray-100 rounded" />
          <div className="h-12 bg-gray-100 rounded" />
          <div className="h-12 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!picks || picks.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#EA580C] mb-3">
        Deploy Capital Here
      </p>
      <div className="space-y-3">
        {picks.map((pick, i) => (
          <div key={i} className="border-l-3 border-green-500 pl-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#1E293B]">{pick.market}</span>
              <span className="text-[10px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                {pick.ratio.toFixed(2)}
              </span>
            </div>
            <p className="text-[11px] text-[#4B5563] leading-snug mt-0.5">{pick.reason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
