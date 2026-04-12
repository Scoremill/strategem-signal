"use client";

import { useState } from "react";

interface Market {
  id: string;
  shortName: string;
  state: string;
  ratio: number;
  status: string;
  estMonthlyStarts: number | null;
}

interface FeasibilityResult {
  input: {
    marketName: string;
    marketState: string;
    totalLots: number;
    startsPerMonth: number;
    estMonthlyStarts: number;
    tradeWorkers: number;
    tradeAvailability: number;
    wageGrowthYoy: number;
    demandCapacityRatio: number;
    status: string;
    demandIndex: number;
    capacityIndex: number;
    establishments: number;
  };
  marketShare: number;
  laborAbsorption: number;
  tradeWorkersNeeded: number;
  cycleTimeRiskFactor: number;
  costEscalationEstimate: number;
  absorptionMonths: number;
  goNoGo: "green" | "yellow" | "red";
  confidence: "high" | "medium" | "low";
  summary: string;
  risks: string[];
  recommendations: string[];
}

const GONOGO_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  green: { bg: "bg-green-50", text: "text-green-800", border: "border-green-500", label: "Go — Deploy Capital" },
  yellow: { bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-500", label: "Caution — Risk Mitigation Required" },
  red: { bg: "bg-red-50", text: "text-red-800", border: "border-red-500", label: "No-Go — High Risk of Margin Erosion" },
};

export default function FeasibilityClient({ markets }: { markets: Market[] }) {
  const [geographyId, setGeographyId] = useState("");
  const [totalLots, setTotalLots] = useState("300");
  const [startsPerMonth, setStartsPerMonth] = useState("8");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FeasibilityResult | null>(null);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!geographyId) {
      setError("Please select a market");
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/feasibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          geographyId,
          totalLots: parseInt(totalLots),
          startsPerMonth: parseInt(startsPerMonth),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
      } else {
        setError(data.error || "Analysis failed");
      }
    } catch {
      setError("Failed to run analysis");
    } finally {
      setLoading(false);
    }
  }

  const style = result ? GONOGO_STYLES[result.goNoGo] : null;

  return (
    <div className="space-y-8">
      {/* Input Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-[#1E293B] mb-1">Community Stress Test</h2>
        <p className="text-sm text-[#6B7280] mb-6">
          Enter your proposed community size and target pace. We&apos;ll assess whether the market can absorb it without destroying your margins.
        </p>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1.5">Market</label>
            <select
              value={geographyId}
              onChange={(e) => setGeographyId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-[#1E293B] focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent"
            >
              <option value="">Select a market...</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.shortName}, {m.state} — D/C {m.ratio.toFixed(2)} ({m.status})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1.5">Total Lots</label>
            <input
              type="number"
              value={totalLots}
              onChange={(e) => setTotalLots(e.target.value)}
              min="1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-[#1E293B] focus:outline-none focus:ring-2 focus:ring-[#F97316]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-1.5">Starts / Month</label>
            <input
              type="number"
              value={startsPerMonth}
              onChange={(e) => setStartsPerMonth(e.target.value)}
              min="1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-[#1E293B] focus:outline-none focus:ring-2 focus:ring-[#F97316]"
            />
          </div>
          <div className="md:col-span-4">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-[#F97316] hover:bg-[#EA580C] text-white font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? "Running stress test..." : "Run Feasibility Analysis"}
            </button>
            {error && <span className="ml-3 text-sm text-red-600">{error}</span>}
          </div>
        </form>
      </div>

      {/* Results */}
      {result && style && (
        <div className="space-y-6">
          {/* Go/No-Go Banner */}
          <div className={`rounded-xl border-l-4 ${style.border} ${style.bg} p-6`}>
            <p className={`text-xs font-semibold uppercase tracking-wider ${style.text} mb-1`}>Recommendation</p>
            <h2 className={`text-2xl font-bold ${style.text} mb-3`}>{style.label}</h2>
            <p className="text-sm text-[#1E293B] leading-relaxed">{result.summary}</p>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Your Market Share</p>
              <p className={`text-3xl font-bold mt-1 ${result.marketShare > 10 ? "text-red-700" : result.marketShare > 5 ? "text-amber-700" : "text-[#1E293B]"}`}>
                {result.marketShare}%
              </p>
              <p className="text-[10px] text-[#6B7280] mt-1">
                {result.input.startsPerMonth} of {result.input.estMonthlyStarts.toLocaleString()} est. market starts/mo
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Labor Absorption</p>
              <p className={`text-3xl font-bold mt-1 ${result.laborAbsorption > 80 ? "text-red-700" : result.laborAbsorption > 50 ? "text-amber-700" : "text-green-700"}`}>
                {result.laborAbsorption}%
              </p>
              <p className="text-[10px] text-[#6B7280] mt-1">
                Est. {result.tradeWorkersNeeded.toLocaleString()} workers needed
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Cycle Time Risk</p>
              <p className={`text-3xl font-bold mt-1 ${result.cycleTimeRiskFactor > 1.2 ? "text-red-700" : result.cycleTimeRiskFactor > 1.0 ? "text-amber-700" : "text-green-700"}`}>
                {result.cycleTimeRiskFactor}x
              </p>
              <p className="text-[10px] text-[#6B7280] mt-1">
                Baseline cycle time multiplier
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Cost Escalation</p>
              <p className={`text-3xl font-bold mt-1 ${result.costEscalationEstimate > 10 ? "text-red-700" : result.costEscalationEstimate > 5 ? "text-amber-700" : "text-green-700"}`}>
                +{result.costEscalationEstimate}%
              </p>
              <p className="text-[10px] text-[#6B7280] mt-1">
                Over {result.absorptionMonths}-mo lifecycle
              </p>
            </div>
          </div>

          {/* Risks & Recommendations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Risks */}
            <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
              <div className="px-5 py-3 bg-red-50 border-b border-red-200">
                <h3 className="text-sm font-semibold text-red-800">Key Risks</h3>
              </div>
              <ul className="divide-y divide-gray-100">
                {result.risks.map((risk, i) => (
                  <li key={i} className="px-5 py-3 text-sm text-[#1E293B] leading-relaxed flex gap-3">
                    <span className="text-red-500 flex-shrink-0">▪</span>
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Recommendations */}
            <div className="bg-white rounded-xl border border-green-200 overflow-hidden">
              <div className="px-5 py-3 bg-green-50 border-b border-green-200">
                <h3 className="text-sm font-semibold text-green-800">Recommended Actions</h3>
              </div>
              <ul className="divide-y divide-gray-100">
                {result.recommendations.map((rec, i) => (
                  <li key={i} className="px-5 py-3 text-sm text-[#1E293B] leading-relaxed flex gap-3">
                    <span className="text-green-600 flex-shrink-0">✓</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Data Appendix */}
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">Analysis Inputs</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-[#6B7280]">Market</p>
                <p className="font-semibold text-[#1E293B]">{result.input.marketName}, {result.input.marketState}</p>
              </div>
              <div>
                <p className="text-[#6B7280]">D/C Ratio</p>
                <p className="font-semibold text-[#1E293B]">{result.input.demandCapacityRatio.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[#6B7280]">Trade Workers</p>
                <p className="font-semibold text-[#1E293B]">{result.input.tradeWorkers.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[#6B7280]">Trade Contractors</p>
                <p className="font-semibold text-[#1E293B]">{result.input.establishments.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[#6B7280]">Wage Growth YoY</p>
                <p className="font-semibold text-[#1E293B]">{result.input.wageGrowthYoy}%</p>
              </div>
              <div>
                <p className="text-[#6B7280]">Trade Availability</p>
                <p className="font-semibold text-[#1E293B]">{result.input.tradeAvailability}</p>
              </div>
              <div>
                <p className="text-[#6B7280]">Absorption Period</p>
                <p className="font-semibold text-[#1E293B]">{result.absorptionMonths} months</p>
              </div>
              <div>
                <p className="text-[#6B7280]">Confidence</p>
                <p className="font-semibold text-[#1E293B] capitalize">{result.confidence}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
