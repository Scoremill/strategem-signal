"use client";

import { useEffect, useState } from "react";

interface TopPick {
  market: string;
  reason: string;
  ratio: number;
  caution: string;
}

interface TopPicksPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TopPicksPanel({ isOpen, onClose }: TopPicksPanelProps) {
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

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  return (
    <div
      aria-hidden={!isOpen}
      className={`absolute top-28 right-4 z-20 w-80 max-w-[90vw] max-h-[calc(100%-8rem)] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col transform transition-all duration-200 ease-out ${
        isOpen ? "opacity-100 translate-x-0 pointer-events-auto" : "opacity-0 translate-x-4 pointer-events-none"
      }`}
    >
      <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#EA580C]">
            Top Picks
          </p>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="p-1 -m-1 rounded text-[#6B7280] hover:bg-gray-100 hover:text-[#1E293B] transition-colors flex-shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-[#6B7280] mt-0.5">Favorable for capital deployment</p>
      </div>

      <div className="overflow-y-auto p-4 flex-1">
        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-12 bg-gray-100 rounded" />
            <div className="h-12 bg-gray-100 rounded" />
            <div className="h-12 bg-gray-100 rounded" />
          </div>
        ) : !picks || picks.length === 0 ? (
          <p className="text-xs text-[#6B7280]">No data available.</p>
        ) : (
          <div className="space-y-3">
            {picks.map((pick, i) => (
              <div key={i} className="border-l-2 border-green-500 pl-3">
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
        )}
      </div>
    </div>
  );
}
