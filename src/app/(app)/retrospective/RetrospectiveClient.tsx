"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
} from "recharts";

export interface RetroMarket {
  id: string;
  name: string;
  shortName: string;
  state: string;
  population: number | null;
  zhvi: Array<{ date: string; value: number | null }>;
  hpi: Array<{ label: string; hpi: number | null; yoy: number | null }>;
  health: {
    composite: number;
    financial: number;
    demand: number;
    operational: number;
    snapshotDate: string;
  } | null;
  opportunity: {
    filter1: number;
    filter2: number;
    filter3: number;
    filter4: number | null;
    filter5: number | null;
    filter6: number;
    numGreen: number;
  } | null;
}

interface Props {
  markets: RetroMarket[];
}

const NARRATIVES: Record<string, { headline: string; thesis: string; signal: string; timing: string }> = {
  "bf1c148a-d548-4015-a537-7df6de9d6ad3": {
    headline: "Greenville-Anderson, SC — Diversified Growth with Room to Build",
    thesis:
      "Greenville-Anderson has emerged as one of the Southeast's most balanced growth markets. A diversified employer base (BMW, Michelin, healthcare, logistics) spreads risk across multiple sectors — the Employment Diversity score of 80 confirms this isn't a single-industry town. Net domestic migration scores at the maximum, driven by cost-of-living refugees from the Northeast corridor and retirees attracted to the Upstate's quality of life. The supply-demand imbalance score of 69 indicates builders have not yet caught up to inbound demand.",
    signal:
      "StrategemSignal would have flagged Greenville-Anderson as early as mid-2024 based on three converging signals: sustained population inflow exceeding permit issuance, broad employment diversification insulating the market from sector-specific shocks, and home price appreciation running below income growth — a widening affordability runway. The competitive landscape shows only 5 public builders active, leaving significant whitespace for organic market entry.",
    timing:
      "A CEO reviewing this market in Q2 2024 would have seen median home values around $300K with steady 3-4% annual appreciation — well below the national hot-market pace. By Q1 2026, values crossed $340K. The window for land acquisition at pre-discovery pricing is narrowing but still open compared to peer Sunbelt metros.",
  },
  "438fc4d5-8e50-40c5-a171-3b10bd4c4a73": {
    headline: "Nashville, TN — Supply Crunch in a Boom Market",
    thesis:
      "Nashville's story is supply-demand imbalance at scale. The metro scores 97 on Supply-Demand Imbalance — among the highest in the country — meaning population growth is dramatically outpacing new housing permits. Migration scores at the maximum as Nashville continues to attract corporate relocations (Oracle, Amazon, AllianceBernstein) and young professionals. However, the market is crowded: 9 public builders already operate here, making it one of the most contested metros in the tracked universe. Nashville's real employer base spans healthcare, finance, logistics, music/entertainment, and tech — a genuinely diversified economy that supports durable housing demand.",
    signal:
      "StrategemSignal would have raised a nuanced flag: enormous demand opportunity but with significant competitive risk. The platform would have recommended this market for builders with existing Southeast operations who can leverage scale advantages, while cautioning against it as a first-market entry given the 9-builder competitive density. The operational feasibility score of 46 confirms trade labor constraints that would challenge a new entrant.",
    timing:
      "Nashville's ZHVI crossed $450K by early 2025. FHFA HPI data shows consistent 5-7% annual appreciation with no signs of cooling. A builder entering in mid-2024 at $420K median would already see 7% paper appreciation — but the real opportunity is in lot acquisition for 2027-2028 deliveries, when the current permit deficit creates acute inventory shortages.",
  },
  "3a1b5917-de77-4e71-92c9-e4d08f56c15e": {
    headline: "Fayetteville-Springdale, AR — The Under-the-Radar Opportunity",
    thesis:
      "Northwest Arkansas is the definition of a hidden-gem market. Anchored by Walmart, Tyson Foods, and J.B. Hunt — three Fortune 500 headquarters within 30 miles — the metro has built a second wave of growth around tech talent attracted by the Walton family's $1B+ investment in cultural amenities and trail systems. The migration score is at maximum, and the supply-demand imbalance of 83 shows builders are severely under-building relative to population growth. With only 1 public builder active (competitive score of 92), this is among the least contested markets in the tracked universe.",
    signal:
      "This is exactly the type of market StrategemSignal was built to find: strong demand fundamentals, minimal public-builder competition, and an affordability profile that supports first-time and move-up buyers. The platform would have flagged this market in early 2024 with a clear \"investigate for organic entry\" recommendation. The one caution: operational feasibility scores just 29, reflecting tight trade labor markets — a builder entering here needs a workforce development strategy.",
    timing:
      "Median home values sat below $350K through mid-2025, with annualized appreciation of 2-3% — gentle enough that a land position taken in 2024 would not have required aggressive pricing assumptions. The market is still early in its institutional discovery phase, meaning the arbitrage between local fundamentals and national builder awareness remains wide.",
  },
};

function formatCurrency(value: number): string {
  return "$" + Math.round(value).toLocaleString();
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function scoreColor(score: number): string {
  if (score >= 65) return "#15803D";
  if (score >= 55) return "#047857";
  if (score >= 45) return "#854D0E";
  if (score >= 35) return "#9A3412";
  return "#991B1B";
}

function scoreBg(score: number): string {
  if (score >= 65) return "#DCFCE7";
  if (score >= 55) return "#ECFDF5";
  if (score >= 45) return "#FEF9C3";
  if (score >= 35) return "#FFEDD5";
  return "#FEE2E2";
}

function barColor(score: number | null): string {
  if (score == null) return "#D1D5DB";
  if (score >= 60) return "#059669";
  if (score >= 40) return "#D97706";
  return "#DC2626";
}

export default function RetrospectiveClient({ markets }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const market = markets[selectedIdx];
  const narrative = market ? NARRATIVES[market.id] : null;

  if (markets.length === 0) {
    return (
      <div className="p-8 text-center text-[#6B7280]">
        No retrospective markets configured.
      </div>
    );
  }

  const zhviData = market.zhvi
    .filter((d) => d.value != null)
    .map((d) => ({
      date: formatDate(d.date),
      rawDate: d.date,
      value: d.value!,
    }));

  const hpiData = market.hpi.filter((d) => d.hpi != null);

  const oppFilters = market.opportunity
    ? [
        { label: "Migration", score: market.opportunity.filter1 },
        { label: "Diversity", score: market.opportunity.filter2 },
        { label: "Imbalance", score: market.opportunity.filter3 },
        { label: "Competition", score: market.opportunity.filter4 },
        { label: "Affordability", score: market.opportunity.filter5 },
        { label: "Operational", score: market.opportunity.filter6 },
      ]
    : [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Intro banner */}
      <div className="bg-gradient-to-r from-orange-50 to-white border border-orange-200 rounded-xl p-5">
        <h2 className="text-base font-semibold text-[#1E293B]">
          What would StrategemSignal have told you?
        </h2>
        <p className="text-sm text-[#4B5563] mt-1">
          Three real markets analyzed through the platform's scoring engine.
          Each demonstrates a different pattern — hidden opportunity,
          contested growth, and under-the-radar value — that the platform
          surfaces months before consensus.
        </p>
      </div>

      {/* Market selector tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {markets.map((m, i) => (
          <button
            key={m.id}
            onClick={() => setSelectedIdx(i)}
            className={`flex-shrink-0 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              i === selectedIdx
                ? "bg-[#F97316] text-white shadow-sm"
                : "bg-white border border-gray-200 text-[#4B5563] hover:border-[#F97316] hover:text-[#EA580C]"
            }`}
          >
            {m.shortName}, {m.state}
          </button>
        ))}
      </div>

      {market && narrative && (
        <>
          {/* Narrative header */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-lg font-semibold text-[#1E293B]">
              {narrative.headline}
            </h3>
            {market.population && (
              <p className="text-xs text-[#6B7280] mt-1">
                Metro population: {market.population.toLocaleString()}
              </p>
            )}
            <div className="mt-4 space-y-3 text-sm text-[#4B5563] leading-relaxed">
              <p>{narrative.thesis}</p>
            </div>
          </div>

          {/* Score cards row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {market.health && (
              <>
                <ScoreCard
                  label="Composite"
                  score={market.health.composite}
                />
                <ScoreCard
                  label="Financial"
                  score={market.health.financial}
                />
                <ScoreCard label="Demand" score={market.health.demand} />
                <ScoreCard
                  label="Operational"
                  score={market.health.operational}
                />
              </>
            )}
          </div>

          {/* Six-filter bar chart */}
          {oppFilters.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h4 className="text-sm font-semibold text-[#1E293B] mb-1">
                Market Opportunity — Six Filters
              </h4>
              <p className="text-xs text-[#6B7280] mb-4">
                {market.opportunity!.numGreen} of 6 filters pass (score
                &ge; 60)
              </p>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={oppFilters}
                    margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#E5E7EB"
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#6B7280" }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: "#6B7280" }}
                    />
                    <ReferenceLine
                      y={60}
                      stroke="#059669"
                      strokeDasharray="4 4"
                      label={{
                        value: "Pass",
                        position: "right",
                        fontSize: 10,
                        fill: "#059669",
                      }}
                    />
                    <Tooltip
                      formatter={(v) => [
                        v != null ? Number(v).toFixed(1) : "N/A",
                        "Score",
                      ]}
                      labelStyle={{ color: "#1E293B", fontWeight: 600 }}
                      contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB" }}
                    />
                    <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                      {oppFilters.map((f, i) => (
                        <Cell key={i} fill={barColor(f.score)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ZHVI price trend */}
          {zhviData.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h4 className="text-sm font-semibold text-[#1E293B] mb-1">
                Home Price Trend — Zillow ZHVI
              </h4>
              <p className="text-xs text-[#6B7280] mb-4">
                {formatDate(zhviData[0].rawDate)} &ndash;{" "}
                {formatDate(zhviData[zhviData.length - 1].rawDate)}
                {" · "}
                {formatCurrency(zhviData[0].value)} &rarr;{" "}
                {formatCurrency(zhviData[zhviData.length - 1].value)}
                {" ("}
                {(
                  ((zhviData[zhviData.length - 1].value - zhviData[0].value) /
                    zhviData[0].value) *
                  100
                ).toFixed(1)}
                {"% total)"}
              </p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={zhviData}
                    margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#E5E7EB"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#6B7280" }}
                      interval={5}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#6B7280" }}
                      tickFormatter={(v: number) =>
                        "$" + (v / 1000).toFixed(0) + "K"
                      }
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      formatter={(v) => [formatCurrency(Number(v)), "ZHVI"]}
                      labelStyle={{ fontSize: 11, color: "#1E293B", fontWeight: 600 }}
                      contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#F97316"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: "#EA580C" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* FHFA HPI trend */}
          {hpiData.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h4 className="text-sm font-semibold text-[#1E293B] mb-1">
                House Price Appreciation — FHFA HPI
              </h4>
              <p className="text-xs text-[#6B7280] mb-4">
                Quarterly year-over-year change in FHFA House Price Index
              </p>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={hpiData}
                    margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#E5E7EB"
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "#6B7280" }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#6B7280" }}
                      tickFormatter={(v: number) => v.toFixed(1) + "%"}
                    />
                    <ReferenceLine y={0} stroke="#9CA3AF" />
                    <Tooltip
                      formatter={(v) => [
                        v != null ? Number(v).toFixed(2) + "%" : "N/A",
                        "YoY",
                      ]}
                      labelStyle={{ color: "#1E293B", fontWeight: 600 }}
                      contentStyle={{ borderRadius: 8, border: "1px solid #E5E7EB" }}
                    />
                    <Bar dataKey="yoy" radius={[4, 4, 0, 0]}>
                      {hpiData.map((d, i) => (
                        <Cell
                          key={i}
                          fill={
                            (d.yoy ?? 0) >= 0 ? "#059669" : "#DC2626"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Signal + Timing narrative */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-[#1E293B] mb-2">
                What the platform would have flagged
              </h4>
              <p className="text-sm text-[#4B5563] leading-relaxed">
                {narrative.signal}
              </p>
            </div>
            <div className="border-t border-gray-100 pt-4">
              <h4 className="text-sm font-semibold text-[#1E293B] mb-2">
                Timing window
              </h4>
              <p className="text-sm text-[#4B5563] leading-relaxed">
                {narrative.timing}
              </p>
            </div>
          </div>

          {/* Data sources footer */}
          <div className="text-xs text-[#9CA3AF] border-t border-gray-100 pt-4 pb-2">
            <p>
              <strong>Data sources:</strong> Zillow Home Value Index (ZHVI),
              FHFA House Price Index, Census Building Permits (BPS), Census
              Population Estimates (PEP), Census American Community Survey
              (ACS), BLS Current Employment Statistics (CES), BLS Local Area
              Unemployment Statistics (LAUS), BLS Quarterly Census of
              Employment and Wages (QCEW), StrategemOps Earnings Narratives.
            </p>
            <p className="mt-1">
              Scores reflect the latest available snapshot. Historical
              narratives describe what signals were present in the
              underlying data at each point in time.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function ScoreCard({ label, score }: { label: string; score: number }) {
  return (
    <div
      className="rounded-lg border px-4 py-3 text-center"
      style={{
        backgroundColor: scoreBg(score),
        borderColor: scoreColor(score) + "30",
      }}
    >
      <div
        className="text-2xl font-bold"
        style={{ color: scoreColor(score) }}
      >
        {score.toFixed(1)}
      </div>
      <div className="text-xs font-medium text-[#6B7280] mt-0.5">
        {label}
      </div>
    </div>
  );
}
