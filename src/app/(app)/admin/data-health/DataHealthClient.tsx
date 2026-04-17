"use client";

import { useState } from "react";

export interface MarketCoverage {
  id: string;
  shortName: string;
  state: string;
  cbsaFips: string;
  permits: number;
  employment: number;
  unemployment: number;
  migration: number;
  income: number;
  qcew: number;
  zhvi: number;
  fhfa: number;
  composite: number | null;
  demand: number | null;
  financial: number | null;
  operational: number | null;
}

interface Summary {
  total: number;
  permits: number;
  employment: number;
  unemployment: number;
  migration: number;
  income: number;
  qcew: number;
  zhvi: number;
  fhfa: number;
  allThreeScores: number;
}

interface Props {
  markets: MarketCoverage[];
  summary: Summary;
}

type FilterMode = "all" | "gaps" | "complete";

function pct(n: number, total: number): string {
  return total > 0 ? ((n / total) * 100).toFixed(0) + "%" : "0%";
}

function coverageBg(count: number): string {
  if (count >= 12) return "#DCFCE7"; // green — 12+ months
  if (count > 0) return "#FEF9C3"; // yellow — some data
  return "#FEE2E2"; // red — empty
}

function coverageText(count: number): string {
  if (count >= 12) return "#15803D";
  if (count > 0) return "#854D0E";
  return "#991B1B";
}

function scoreBg(score: number | null): string {
  if (score == null) return "#F3F4F6";
  if (score >= 65) return "#DCFCE7";
  if (score >= 55) return "#ECFDF5";
  if (score >= 45) return "#FEF9C3";
  if (score >= 35) return "#FFEDD5";
  return "#FEE2E2";
}

function scoreText(score: number | null): string {
  if (score == null) return "#9CA3AF";
  if (score >= 65) return "#15803D";
  if (score >= 55) return "#047857";
  if (score >= 45) return "#854D0E";
  if (score >= 35) return "#9A3412";
  return "#991B1B";
}

function hasGaps(m: MarketCoverage): boolean {
  return (
    m.permits === 0 ||
    m.employment === 0 ||
    m.income === 0 ||
    m.qcew === 0 ||
    m.demand == null ||
    m.financial == null ||
    m.operational == null
  );
}

const DATA_SOURCES = [
  { key: "permits" as const, label: "Permits", source: "Census BPS" },
  { key: "employment" as const, label: "Employment", source: "BLS CES" },
  { key: "unemployment" as const, label: "Unemp Rate", source: "BLS LAUS" },
  { key: "migration" as const, label: "Population", source: "Census PEP" },
  { key: "income" as const, label: "Income", source: "Census ACS" },
  { key: "qcew" as const, label: "Trade Wages", source: "BLS QCEW" },
  { key: "zhvi" as const, label: "Home Values", source: "Zillow ZHVI" },
  { key: "fhfa" as const, label: "HPI", source: "FHFA" },
];

export default function DataHealthClient({ markets, summary }: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");

  const filtered = markets.filter((m) => {
    if (filter === "gaps" && !hasGaps(m)) return false;
    if (filter === "complete" && hasGaps(m)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        m.shortName.toLowerCase().includes(q) ||
        m.state.toLowerCase().includes(q) ||
        m.cbsaFips.includes(q)
      );
    }
    return true;
  });

  return (
    <div className="max-w-[100rem] mx-auto px-4 py-6 space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <SummaryCard
          label="Markets"
          value={summary.total}
          detail="active"
        />
        <SummaryCard
          label="Full Scores"
          value={summary.allThreeScores}
          detail={`${pct(summary.allThreeScores, summary.total)} of total`}
          warn={summary.allThreeScores < summary.total}
        />
        <SummaryCard
          label="Permits"
          value={summary.permits}
          detail={pct(summary.permits, summary.total)}
          warn={summary.permits < summary.total}
        />
        <SummaryCard
          label="Employment"
          value={summary.employment}
          detail={pct(summary.employment, summary.total)}
          warn={summary.employment < summary.total}
        />
        <SummaryCard
          label="Population"
          value={summary.migration}
          detail={pct(summary.migration, summary.total)}
          warn={summary.migration < summary.total}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(["all", "gaps", "complete"] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={`px-3 py-1.5 capitalize ${
                filter === mode
                  ? "bg-[#F97316] text-white font-medium"
                  : "bg-white text-[#4B5563] hover:bg-gray-50"
              }`}
            >
              {mode === "gaps"
                ? `Gaps (${markets.filter(hasGaps).length})`
                : mode === "complete"
                ? `Complete (${markets.filter((m) => !hasGaps(m)).length})`
                : `All (${markets.length})`}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search market or state..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-[#1E293B] placeholder-[#9CA3AF] w-56"
        />
      </div>

      {/* Coverage table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-3 py-2 font-semibold text-[#1E293B] sticky left-0 bg-gray-50 z-10 min-w-[160px]">
                Market
              </th>
              {DATA_SOURCES.map((ds) => (
                <th
                  key={ds.key}
                  className="px-2 py-2 font-semibold text-[#1E293B] text-center min-w-[70px]"
                >
                  <div>{ds.label}</div>
                  <div className="font-normal text-[#9CA3AF] text-[10px]">
                    {ds.source}
                  </div>
                </th>
              ))}
              <th className="px-2 py-2 font-semibold text-[#1E293B] text-center">
                Composite
              </th>
              <th className="px-2 py-2 font-semibold text-[#1E293B] text-center">
                Financial
              </th>
              <th className="px-2 py-2 font-semibold text-[#1E293B] text-center">
                Demand
              </th>
              <th className="px-2 py-2 font-semibold text-[#1E293B] text-center">
                Operational
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr
                key={m.id}
                className="border-b border-gray-100 hover:bg-gray-50/50"
              >
                <td className="px-3 py-2 font-medium text-[#1E293B] sticky left-0 bg-white z-10">
                  {m.shortName}, {m.state}
                  <span className="text-[10px] text-[#9CA3AF] ml-1">
                    {m.cbsaFips}
                  </span>
                </td>
                {DATA_SOURCES.map((ds) => {
                  const count = m[ds.key];
                  return (
                    <td
                      key={ds.key}
                      className="px-2 py-2 text-center font-mono"
                      style={{
                        backgroundColor: coverageBg(count),
                        color: coverageText(count),
                      }}
                    >
                      {count}
                    </td>
                  );
                })}
                <ScoreCell score={m.composite} />
                <ScoreCell score={m.financial} />
                <ScoreCell score={m.demand} />
                <ScoreCell score={m.operational} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-[#6B7280] border-t border-gray-100 pt-4">
        <div className="flex items-center gap-1.5">
          <span
            className="w-4 h-4 rounded"
            style={{ backgroundColor: "#DCFCE7" }}
          />
          12+ months of data
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="w-4 h-4 rounded"
            style={{ backgroundColor: "#FEF9C3" }}
          />
          Some data (less than 12 months)
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="w-4 h-4 rounded"
            style={{ backgroundColor: "#FEE2E2" }}
          />
          No data
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  warn,
}: {
  label: string;
  value: number;
  detail: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        warn ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"
      }`}
    >
      <div
        className={`text-2xl font-bold ${
          warn ? "text-amber-700" : "text-[#1E293B]"
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-[#6B7280]">
        {label} · {detail}
      </div>
    </div>
  );
}

function ScoreCell({ score }: { score: number | null }) {
  return (
    <td
      className="px-2 py-2 text-center font-mono"
      style={{
        backgroundColor: scoreBg(score),
        color: scoreText(score),
      }}
    >
      {score != null ? score.toFixed(1) : "—"}
    </td>
  );
}
