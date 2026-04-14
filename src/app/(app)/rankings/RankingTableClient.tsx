"use client";

import { useMemo } from "react";
import Link from "next/link";
import SortableTable from "@/components/SortableTable";
import type { WeightPreset } from "@/lib/scoring/weight-presets";

export interface RankingRow {
  id: string;
  shortName: string;
  state: string;
  financial: number | null;
  demand: number | null;
  operational: number | null;
  snapshotDate: string | null;
}

interface RankingTableClientProps {
  rows: RankingRow[];
  preset: WeightPreset;
}

/**
 * Client-side composite blend. Matches the scorer's missing-data
 * policy: if a sub-score is null, its weight is redistributed across
 * the remaining sub-scores rather than dragging the composite to zero.
 */
function blendComposite(
  financial: number | null,
  demand: number | null,
  operational: number | null,
  weights: WeightPreset["weights"]
): number | null {
  const parts: Array<[number, number]> = [];
  if (financial != null) parts.push([financial, weights.financial]);
  if (demand != null) parts.push([demand, weights.demand]);
  if (operational != null) parts.push([operational, weights.operational]);
  if (parts.length === 0) return null;
  let sum = 0;
  let wsum = 0;
  for (const [s, w] of parts) {
    sum += s * w;
    wsum += w;
  }
  return wsum > 0 ? sum / wsum : null;
}

/**
 * Color the composite cell by band. Same scale as the heatmap legend
 * so the two views agree visually.
 */
function compositeBandClass(composite: number | null): string {
  if (composite == null) return "text-[#9CA3AF]";
  if (composite >= 65) return "text-emerald-700 font-semibold";
  if (composite >= 55) return "text-emerald-600 font-semibold";
  if (composite >= 45) return "text-amber-600 font-semibold";
  if (composite >= 35) return "text-orange-600 font-semibold";
  return "text-red-600 font-semibold";
}

/**
 * Individual sub-score cells are lighter — the composite is the headline,
 * the sub-scores are supporting detail at a glance.
 */
function subScoreCellClass(score: number | null): string {
  if (score == null) return "text-[#9CA3AF] tabular-nums";
  return "text-[#1E293B] tabular-nums";
}

export default function RankingTableClient({ rows, preset }: RankingTableClientProps) {
  // Pre-compute composite for every row so the SortableTable can sort on it
  // like any other numeric column.
  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        composite: blendComposite(r.financial, r.demand, r.operational, preset.weights),
      })),
    [rows, preset]
  );

  const columns = [
    { key: "shortName", label: "Market", align: "left" as const },
    { key: "state", label: "State", align: "left" as const },
    { key: "composite", label: "Composite", align: "right" as const },
    { key: "financial", label: "Financial", align: "right" as const },
    { key: "demand", label: "Demand", align: "right" as const },
    { key: "operational", label: "Operational", align: "right" as const },
    { key: "snapshotDate", label: "As of", align: "right" as const },
  ];

  if (enriched.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-sm text-[#6B7280]">
          No markets to rank. Pick some in Settings to build your portfolio view.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <SortableTable
        columns={columns}
        data={enriched as unknown as Record<string, unknown>[]}
        defaultSortKey="composite"
        defaultSortDir="desc"
        renderRow={(row, i) => {
          const r = row as unknown as RankingRow & { composite: number | null };
          return (
            <tr
              key={r.id}
              className={`hover:bg-orange-50/30 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}
            >
              <td className="py-3 px-3 sm:px-5 text-left">
                <Link
                  href={`/markets/${r.id}`}
                  className="text-sm font-medium text-[#1E293B] hover:text-[#EA580C] transition-colors"
                >
                  {r.shortName}
                </Link>
              </td>
              <td className="py-3 px-3 sm:px-5 text-left text-[11px] text-[#6B7280]">
                {r.state}
              </td>
              <td className={`py-3 px-3 sm:px-5 text-right text-base tabular-nums ${compositeBandClass(r.composite)}`}>
                {r.composite != null ? r.composite.toFixed(0) : "—"}
              </td>
              <td className={`py-3 px-3 sm:px-5 text-right text-sm ${subScoreCellClass(r.financial)}`}>
                {r.financial != null ? r.financial.toFixed(0) : "—"}
              </td>
              <td className={`py-3 px-3 sm:px-5 text-right text-sm ${subScoreCellClass(r.demand)}`}>
                {r.demand != null ? r.demand.toFixed(0) : "—"}
              </td>
              <td className={`py-3 px-3 sm:px-5 text-right text-sm ${subScoreCellClass(r.operational)}`}>
                {r.operational != null ? r.operational.toFixed(0) : "—"}
              </td>
              <td className="py-3 px-3 sm:px-5 text-right text-[11px] text-[#6B7280] tabular-nums">
                {r.snapshotDate ?? "—"}
              </td>
            </tr>
          );
        }}
      />
    </div>
  );
}
