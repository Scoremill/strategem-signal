"use client";

import { useState, useMemo } from "react";

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
  oppF1: number | null;
  oppF2: number | null;
  oppF3: number | null;
  oppF4: number | null;
  oppF5: number | null;
  oppF6: number | null;
  sectorCount: number;
  permitMonths: number;
  employmentMonths: number;
}

interface Props {
  markets: MarketCoverage[];
}

// ─── Quality checks ─────────────────────────────────────────────

interface QualityIssue {
  severity: "error" | "warning";
  message: string;
}

function getQualityIssues(m: MarketCoverage): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // Diversity score anomaly
  if (m.oppF2 === 0 && m.sectorCount > 0 && m.sectorCount < 10) {
    issues.push({
      severity: "error",
      message: `Diversity=0 with only ${m.sectorCount} NAICS sectors (need 15+ for reliable HHI)`,
    });
  }
  if (m.oppF2 === 0 && m.sectorCount === 0) {
    issues.push({
      severity: "warning",
      message: "No sector breakdown data — diversity score cannot compute",
    });
  }

  // Extreme scores that suggest bad data
  if (m.composite !== null && (m.composite === 0 || m.composite === 100)) {
    issues.push({ severity: "error", message: `Composite=${m.composite} — likely data issue` });
  }
  if (m.demand !== null && m.demand === 0) {
    issues.push({ severity: "error", message: "Demand=0 — check permit/employment data" });
  }
  if (m.financial !== null && m.financial === 0) {
    issues.push({ severity: "error", message: "Financial=0 — check income data" });
  }

  // Insufficient history for YoY
  if (m.permitMonths > 0 && m.permitMonths < 12) {
    issues.push({
      severity: "warning",
      message: `Only ${m.permitMonths} months of permits (need 12+ for YoY)`,
    });
  }
  if (m.employmentMonths > 0 && m.employmentMonths < 12) {
    issues.push({
      severity: "warning",
      message: `Only ${m.employmentMonths} months of employment (need 12+ for YoY)`,
    });
  }

  // Missing data sources
  if (m.permits === 0) issues.push({ severity: "warning", message: "No permit data" });
  if (m.employment === 0) issues.push({ severity: "warning", message: "No employment data" });
  if (m.migration === 0) issues.push({ severity: "warning", message: "No population/migration data" });
  if (m.income === 0) issues.push({ severity: "warning", message: "No income data" });
  if (m.zhvi === 0) issues.push({ severity: "warning", message: "No Zillow home value data" });

  // Null sub-scores
  if (m.demand === null) issues.push({ severity: "error", message: "Demand score is null" });
  if (m.financial === null) issues.push({ severity: "error", message: "Financial score is null" });
  if (m.operational === null) issues.push({ severity: "error", message: "Operational score is null" });

  return issues;
}

type FilterMode = "all" | "errors" | "warnings" | "clean";

function pct(n: number, total: number): string {
  return total > 0 ? ((n / total) * 100).toFixed(0) + "%" : "0%";
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

function coverageBg(count: number): string {
  if (count >= 12) return "#DCFCE7";
  if (count > 0) return "#FEF9C3";
  return "#FEE2E2";
}

function coverageText(count: number): string {
  if (count >= 12) return "#15803D";
  if (count > 0) return "#854D0E";
  return "#991B1B";
}

export default function DataHealthClient({ markets }: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");

  const issueMap = useMemo(() => {
    const map = new Map<string, QualityIssue[]>();
    for (const m of markets) {
      map.set(m.id, getQualityIssues(m));
    }
    return map;
  }, [markets]);

  const errorCount = markets.filter(
    (m) => (issueMap.get(m.id) || []).some((i) => i.severity === "error")
  ).length;
  const warningCount = markets.filter(
    (m) => {
      const issues = issueMap.get(m.id) || [];
      return issues.length > 0 && !issues.some((i) => i.severity === "error");
    }
  ).length;
  const cleanCount = markets.filter(
    (m) => (issueMap.get(m.id) || []).length === 0
  ).length;

  const filtered = markets.filter((m) => {
    const issues = issueMap.get(m.id) || [];
    if (filter === "errors" && !issues.some((i) => i.severity === "error")) return false;
    if (filter === "warnings" && (issues.length === 0 || issues.some((i) => i.severity === "error"))) return false;
    if (filter === "clean" && issues.length > 0) return false;
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total Markets" value={markets.length} color="slate" />
        <SummaryCard label="Clean" value={cleanCount} detail={pct(cleanCount, markets.length)} color="green" />
        <SummaryCard label="Warnings" value={warningCount} detail="data gaps or thin history" color="amber" />
        <SummaryCard label="Errors" value={errorCount} detail="anomalous scores or bad data" color="red" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(
            [
              { mode: "all" as FilterMode, label: `All (${markets.length})` },
              { mode: "errors" as FilterMode, label: `Errors (${errorCount})` },
              { mode: "warnings" as FilterMode, label: `Warnings (${warningCount})` },
              { mode: "clean" as FilterMode, label: `Clean (${cleanCount})` },
            ] as const
          ).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={`px-3 py-1.5 ${
                filter === mode
                  ? "bg-[#F97316] text-white font-medium"
                  : "bg-white text-[#4B5563] hover:bg-gray-50"
              }`}
            >
              {label}
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

      {/* Market list */}
      <div className="space-y-2">
        {filtered.map((m) => {
          const issues = issueMap.get(m.id) || [];
          const hasError = issues.some((i) => i.severity === "error");
          const hasWarning = issues.length > 0 && !hasError;

          return (
            <div
              key={m.id}
              className={`rounded-xl border p-4 ${
                hasError
                  ? "border-red-200 bg-red-50/50"
                  : hasWarning
                  ? "border-amber-200 bg-amber-50/30"
                  : "border-gray-200 bg-white"
              }`}
            >
              {/* Market header */}
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#1E293B]">
                    {m.shortName}, {m.state}
                    <span className="text-[10px] text-[#9CA3AF] ml-2 font-normal">
                      CBSA {m.cbsaFips}
                    </span>
                  </h3>
                  {issues.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {issues.map((issue, i) => (
                        <div
                          key={i}
                          className={`text-xs ${
                            issue.severity === "error"
                              ? "text-red-700"
                              : "text-amber-700"
                          }`}
                        >
                          {issue.severity === "error" ? "\u2716" : "\u26A0"}{" "}
                          {issue.message}
                        </div>
                      ))}
                    </div>
                  )}
                  {issues.length === 0 && (
                    <div className="text-xs text-emerald-600 mt-1">
                      All data sources populated, no anomalies detected
                    </div>
                  )}
                </div>

                {/* Score pills */}
                <div className="flex gap-1.5 flex-shrink-0">
                  <ScorePill label="C" score={m.composite} />
                  <ScorePill label="F" score={m.financial} />
                  <ScorePill label="D" score={m.demand} />
                  <ScorePill label="O" score={m.operational} />
                </div>
              </div>

              {/* Data source row */}
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 text-[10px]">
                <DataCell label="Permits" count={m.permits} months={m.permitMonths} />
                <DataCell label="Employ" count={m.employment} months={m.employmentMonths} />
                <DataCell label="Unemp" count={m.unemployment} />
                <DataCell label="Pop" count={m.migration} />
                <DataCell label="Income" count={m.income} />
                <DataCell label="QCEW" count={m.qcew} />
                <DataCell label="ZHVI" count={m.zhvi} />
                <DataCell label="HPI" count={m.fhfa} />
              </div>

              {/* Opportunity filters row */}
              <div className="grid grid-cols-6 gap-1.5 text-[10px] mt-1.5">
                <FilterCell label="Migr" score={m.oppF1} />
                <FilterCell label="Divers" score={m.oppF2} warn={m.sectorCount > 0 && m.sectorCount < 10} detail={m.sectorCount > 0 ? `${m.sectorCount} sectors` : undefined} />
                <FilterCell label="Imbal" score={m.oppF3} />
                <FilterCell label="Comp" score={m.oppF4} />
                <FilterCell label="Afford" score={m.oppF5} />
                <FilterCell label="Oper" score={m.oppF6} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-[#6B7280] border-t border-gray-100 pt-4">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-[#DCFCE7]" /> 12+ rows
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-[#FEF9C3]" /> Some data
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-[#FEE2E2]" /> Missing
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-red-700 font-bold">{"\u2716"}</span> Error: score likely wrong
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-amber-700">{"\u26A0"}</span> Warning: data gap
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: number;
  detail?: string;
  color: "slate" | "green" | "amber" | "red";
}) {
  const colorMap = {
    slate: "border-gray-200 bg-white text-[#1E293B]",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-800",
  };
  return (
    <div className={`rounded-lg border px-4 py-3 ${colorMap[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-70">
        {label}
        {detail ? ` \u00B7 ${detail}` : ""}
      </div>
    </div>
  );
}

function ScorePill({ label, score }: { label: string; score: number | null }) {
  return (
    <div
      className="rounded-md px-2 py-1 text-center min-w-[40px]"
      style={{ backgroundColor: scoreBg(score), color: scoreText(score) }}
    >
      <div className="text-[10px] font-medium opacity-60">{label}</div>
      <div className="text-xs font-bold">
        {score != null ? score.toFixed(0) : "\u2014"}
      </div>
    </div>
  );
}

function DataCell({
  label,
  count,
  months,
}: {
  label: string;
  count: number;
  months?: number;
}) {
  const displayMonths = months ?? count;
  return (
    <div
      className="rounded px-1.5 py-1 text-center"
      style={{
        backgroundColor: coverageBg(count),
        color: coverageText(count),
      }}
    >
      <div className="font-medium">{label}</div>
      <div className="font-mono font-bold">{count}</div>
      {months != null && months !== count && (
        <div className="opacity-60">{months}mo</div>
      )}
    </div>
  );
}

function FilterCell({
  label,
  score,
  warn,
  detail,
}: {
  label: string;
  score: number | null;
  warn?: boolean;
  detail?: string;
}) {
  return (
    <div
      className={`rounded px-1.5 py-1 text-center ${
        warn ? "ring-1 ring-red-400" : ""
      }`}
      style={{ backgroundColor: scoreBg(score), color: scoreText(score) }}
    >
      <div className="font-medium">{label}</div>
      <div className="font-mono font-bold">
        {score != null ? score.toFixed(0) : "\u2014"}
      </div>
      {detail && <div className="text-[9px] opacity-60">{detail}</div>}
    </div>
  );
}
