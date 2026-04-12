"use client";

import { useEffect, useState } from "react";

interface Implication {
  market: string;
  implication: string;
  tradePricing: "leverage" | "market" | "premium";
  cycleTimeRisk: "low" | "moderate" | "high";
}

const PRICING_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  leverage: { bg: "bg-green-100", text: "text-green-800", label: "Builder Leverage" },
  market: { bg: "bg-amber-100", text: "text-amber-800", label: "Market Pricing" },
  premium: { bg: "bg-red-100", text: "text-red-800", label: "Premium Pricing" },
};

const RISK_STYLES: Record<string, { bg: string; text: string }> = {
  low: { bg: "bg-green-100", text: "text-green-800" },
  moderate: { bg: "bg-amber-100", text: "text-amber-800" },
  high: { bg: "bg-red-100", text: "text-red-800" },
};

export default function BuilderImplications() {
  const [implications, setImplications] = useState<Implication[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/capacity-narrative", { credentials: "same-origin" });
        if (res.ok) {
          const d = await res.json();
          if (d.implications?.length) setImplications(d.implications);
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
          <p className="text-sm font-semibold text-[#EA580C]">Builder Implications</p>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-16 bg-[#F97316]/10 rounded" />
          <div className="h-16 bg-[#F97316]/10 rounded" />
        </div>
      </div>
    );
  }

  if (!implications) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-5 h-5 bg-[#F97316] rounded-full flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-[#EA580C]">Builder Operational Implications</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="divide-y divide-gray-100">
          {implications.map((imp, i) => {
            const pricing = PRICING_STYLES[imp.tradePricing] || PRICING_STYLES.market;
            const risk = RISK_STYLES[imp.cycleTimeRisk] || RISK_STYLES.moderate;

            return (
              <div key={i} className="px-5 py-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-semibold text-[#1E293B] text-sm">{imp.market}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${pricing.bg} ${pricing.text}`}>
                    {pricing.label}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${risk.bg} ${risk.text}`}>
                    Cycle Time Risk: {imp.cycleTimeRisk}
                  </span>
                </div>
                <p className="text-xs text-[#4B5563] leading-relaxed">{imp.implication}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
