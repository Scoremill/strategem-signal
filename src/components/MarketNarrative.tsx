"use client";

import { useEffect, useState } from "react";

export default function MarketNarrative({ geographyId }: { geographyId: string }) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/narrative/${geographyId}`);
        if (res.ok) {
          const data = await res.json();
          setNarrative(data.full || null);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [geographyId]);

  if (loading) {
    return (
      <div className="bg-[#FFF7ED] rounded-xl border border-[#F97316]/20 p-5 mb-8">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-4 h-4 bg-[#F97316] rounded-full flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#EA580C]">Strategem Market Intelligence</p>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-3 bg-[#F97316]/10 rounded w-full" />
          <div className="h-3 bg-[#F97316]/10 rounded w-5/6" />
          <div className="h-3 bg-[#F97316]/10 rounded w-4/6" />
        </div>
      </div>
    );
  }

  if (!narrative) return null;

  return (
    <div className="bg-[#FFF7ED] rounded-xl border border-[#F97316]/20 p-5 mb-8">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-4 h-4 bg-[#F97316] rounded-full flex items-center justify-center">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[#EA580C]">Strategem Market Intelligence</p>
      </div>
      <p className="text-sm text-[#1E293B] leading-relaxed">{narrative}</p>
    </div>
  );
}
