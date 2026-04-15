"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SortableTable from "@/components/SortableTable";
import type { WeightPreset } from "@/lib/scoring/weight-presets";
import { heatmapCellStyle } from "./heatmap-color";
import { toggleWatchlistMarket } from "../settings/actions";

export interface MarketRow {
  id: string;
  shortName: string;
  state: string;
  // Portfolio Health sub-scores
  financial: number | null;
  demand: number | null;
  operational: number | null;
  // Market Opportunity filters
  filter1: number | null;
  filter2: number | null;
  filter3: number | null;
  filter4: number | null; // STUB
  filter5: number | null; // STUB
  filter6: number | null;
  numGreen: number;
  onWatchlist: boolean;
  snapshotDate: string | null;
}

type Perspective = "health" | "opportunity";

interface MarketsTableClientProps {
  rows: MarketRow[];
  preset: WeightPreset;
}

/**
 * Blend the three Portfolio Health sub-scores using the user's preset.
 * Matches the /heatmap page's client-side blender so the two screens
 * agree on what "composite" means at any weighting.
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

function formatScore(s: number | null): string {
  return s != null ? s.toFixed(0) : "—";
}

export default function MarketsTableClient({ rows, preset }: MarketsTableClientProps) {
  const [perspective, setPerspective] = useState<Perspective>("health");
  const router = useRouter();

  // Pre-compute composite on every row so Portfolio Health perspective
  // can sort on it alongside the raw sub-scores.
  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        composite: blendComposite(r.financial, r.demand, r.operational, preset.weights),
      })),
    [rows, preset]
  );

  // Optimistic watchlist toggle (Opportunity perspective)
  const [localWatchlist, setLocalWatchlist] = useState<Record<string, boolean>>(
    () => {
      const init: Record<string, boolean> = {};
      for (const r of rows) init[r.id] = r.onWatchlist;
      return init;
    }
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleToggleWatchlist(rowId: string, e: React.MouseEvent) {
    e.stopPropagation(); // prevent row click from drilling
    const next = !localWatchlist[rowId];
    setLocalWatchlist((prev) => ({ ...prev, [rowId]: next }));
    setPendingId(rowId);
    startTransition(async () => {
      const result = await toggleWatchlistMarket(rowId, next);
      if (!result.ok) {
        setLocalWatchlist((prev) => ({ ...prev, [rowId]: !next }));
      }
      setPendingId(null);
    });
  }

  const healthColumns = [
    { key: "shortName", label: "Market", align: "left" as const },
    { key: "state", label: "State", align: "left" as const },
    {
      key: "composite",
      label: "Composite",
      align: "center" as const,
      tooltip:
        "Composite Portfolio Health Score (0-100). Blend of Financial, Demand, and Operational sub-scores using your current weighting preset. Higher is healthier. Change your preset in Settings.",
    },
    {
      key: "financial",
      label: "Financial",
      align: "center" as const,
      tooltip:
        "Financial sub-score (0-100). Affordability runway based on Census ACS median household income and YoY income growth. Higher = more buying power in the market.",
    },
    {
      key: "demand",
      label: "Demand",
      align: "center" as const,
      tooltip:
        "Demand sub-score (0-100). Composite of Census single-family permits YoY, BLS employment growth, Census net migration, and BLS unemployment (inverted). Higher = stronger growth signals.",
    },
    {
      key: "operational",
      label: "Operational",
      align: "center" as const,
      tooltip:
        "Operational sub-score (0-100). BLS QCEW construction wage growth (inverted — rising wages are bad for margins) and construction trade employment trajectory. Higher = easier to build and complete on schedule.",
    },
  ];

  const opportunityColumns = [
    { key: "shortName", label: "Market", align: "left" as const },
    { key: "state", label: "State", align: "left" as const },
    {
      key: "numGreen",
      label: "Green",
      align: "center" as const,
      tooltip:
        "Number of the six filters this market passes (score ≥ 60). A '6/6' market would be strong on every dimension; a '3/6' market passes migration and operational but fails affordability, etc. Click any filter cell to see why.",
    },
    {
      key: "filter1",
      label: "Migration",
      align: "center" as const,
      tooltip:
        "Filter 1 — Migration Tailwinds. Net domestic migration as a share of total population (Census PEP). Rewards metros where people are actually moving in. Normalized on [-0.5%, +1.5%] population change.",
    },
    {
      key: "filter2",
      label: "Diversity",
      align: "center" as const,
      tooltip:
        "Filter 2 — Employment Diversity. Herfindahl-Hirschman Index across 2-digit NAICS private-sector employment (BLS QCEW). Penalizes markets where one sector dominates. Rewards metros where a downturn in any single industry wouldn't sink the economy.",
    },
    {
      key: "filter3",
      label: "Imbalance",
      align: "center" as const,
      tooltip:
        "Filter 3 — Supply-Demand Imbalance. Population growth vs permit growth (Census BPS vs Census PEP). Rewards markets where demand is running ahead of supply — the 'find under-built metros' lens from the CEO scenario.",
    },
    {
      key: "filter4",
      label: "Competition*",
      align: "center" as const,
      tooltip:
        "Filter 4 — Competitive Landscape. Counts the number of public homebuilders operating in the market (via LLM-parsed StrategemOps earnings narratives). Inverted — fewer competitors = higher score = easier organic entry. Stubbed when data is pending.",
    },
    {
      key: "filter5",
      label: "Affordability*",
      align: "center" as const,
      tooltip:
        "Filter 5 — Affordability Runway. Income growth vs FHFA House Price Index growth. Rewards markets where incomes are outrunning home prices (runway expanding); penalizes bubble-risk markets (HPI climbing too fast) and flat/cooling markets.",
    },
    {
      key: "filter6",
      label: "Operational",
      align: "center" as const,
      tooltip:
        "Filter 6 — Operational Feasibility. BLS QCEW construction wage growth (inverted) and trade employment trajectory. Same math as the Portfolio Health Operational sub-score — rewards markets where you can actually complete on schedule.",
    },
    { key: "watchlist", label: "", align: "center" as const, sortable: false },
  ];

  const columns = perspective === "health" ? healthColumns : opportunityColumns;
  const defaultSortKey = perspective === "health" ? "composite" : "numGreen";

  return (
    <div className="space-y-4">
      {/* Perspective switcher */}
      <div className="inline-flex items-center gap-1 bg-gray-100 rounded-lg p-1">
        <button
          type="button"
          onClick={() => setPerspective("health")}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            perspective === "health"
              ? "bg-white text-[#1E293B] shadow-sm"
              : "text-[#6B7280] hover:text-[#1E293B]"
          }`}
        >
          Portfolio Health
        </button>
        <button
          type="button"
          onClick={() => setPerspective("opportunity")}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            perspective === "opportunity"
              ? "bg-white text-[#1E293B] shadow-sm"
              : "text-[#6B7280] hover:text-[#1E293B]"
          }`}
        >
          Market Opportunity
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <SortableTable
          columns={columns}
          data={enriched as unknown as Record<string, unknown>[]}
          defaultSortKey={defaultSortKey}
          defaultSortDir="desc"
          renderRow={(row, i) => {
            const r = row as unknown as MarketRow & { composite: number | null };
            const onRowClick = () => router.push(`/markets/${r.id}`);

            if (perspective === "health") {
              return (
                <tr
                  key={r.id}
                  onClick={onRowClick}
                  className={`cursor-pointer hover:bg-orange-50/30 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}
                >
                  <td className="py-3 px-3 sm:px-5 text-left">
                    <span className="text-sm font-medium text-[#1E293B]">{r.shortName}</span>
                  </td>
                  <td className="py-3 px-3 sm:px-5 text-left text-[11px] text-[#6B7280]">
                    {r.state}
                  </td>
                  <td className="py-2 px-2">
                    <div
                      className="rounded-md py-2 text-center text-base font-bold tabular-nums"
                      style={heatmapCellStyle(r.composite)}
                    >
                      {formatScore(r.composite)}
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <div
                      className="rounded-md py-2 text-center text-sm font-semibold tabular-nums"
                      style={heatmapCellStyle(r.financial)}
                    >
                      {formatScore(r.financial)}
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <div
                      className="rounded-md py-2 text-center text-sm font-semibold tabular-nums"
                      style={heatmapCellStyle(r.demand)}
                    >
                      {formatScore(r.demand)}
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <div
                      className="rounded-md py-2 text-center text-sm font-semibold tabular-nums"
                      style={heatmapCellStyle(r.operational)}
                    >
                      {formatScore(r.operational)}
                    </div>
                  </td>
                </tr>
              );
            }

            // Opportunity perspective
            const onList = localWatchlist[r.id] ?? false;
            const isPending = pendingId === r.id;
            const numGreenBg =
              r.numGreen >= 4
                ? "#DCFCE7"
                : r.numGreen === 3
                ? "#ECFDF5"
                : r.numGreen === 2
                ? "#FEF9C3"
                : "#F3F4F6";
            const numGreenFg =
              r.numGreen >= 4
                ? "#15803D"
                : r.numGreen === 3
                ? "#047857"
                : r.numGreen === 2
                ? "#854D0E"
                : "#6B7280";
            return (
              <tr
                key={r.id}
                onClick={onRowClick}
                className={`cursor-pointer hover:bg-orange-50/30 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}
              >
                <td className="py-3 px-3 sm:px-5 text-left">
                  <span className="text-sm font-medium text-[#1E293B]">{r.shortName}</span>
                </td>
                <td className="py-3 px-3 sm:px-5 text-left text-[11px] text-[#6B7280]">
                  {r.state}
                </td>
                <td className="py-2 px-2">
                  <div
                    className="rounded-md py-2 text-center text-sm font-bold tabular-nums"
                    style={{ backgroundColor: numGreenBg, color: numGreenFg }}
                  >
                    {r.numGreen}/6
                  </div>
                </td>
                <td className="py-2 px-2">
                  <div className="rounded-md py-2 text-center text-sm font-semibold tabular-nums" style={heatmapCellStyle(r.filter1)}>
                    {formatScore(r.filter1)}
                  </div>
                </td>
                <td className="py-2 px-2">
                  <div className="rounded-md py-2 text-center text-sm font-semibold tabular-nums" style={heatmapCellStyle(r.filter2)}>
                    {formatScore(r.filter2)}
                  </div>
                </td>
                <td className="py-2 px-2">
                  <div className="rounded-md py-2 text-center text-sm font-semibold tabular-nums" style={heatmapCellStyle(r.filter3)}>
                    {formatScore(r.filter3)}
                  </div>
                </td>
                <td className="py-2 px-2">
                  <div className="rounded-md py-2 text-center text-sm font-semibold tabular-nums" style={heatmapCellStyle(r.filter4)}>
                    {formatScore(r.filter4)}
                  </div>
                </td>
                <td className="py-2 px-2">
                  <div className="rounded-md py-2 text-center text-sm font-semibold tabular-nums" style={heatmapCellStyle(r.filter5)}>
                    {formatScore(r.filter5)}
                  </div>
                </td>
                <td className="py-2 px-2">
                  <div className="rounded-md py-2 text-center text-sm font-semibold tabular-nums" style={heatmapCellStyle(r.filter6)}>
                    {formatScore(r.filter6)}
                  </div>
                </td>
                <td className="py-3 px-2 text-center">
                  <button
                    type="button"
                    onClick={(e) => handleToggleWatchlist(r.id, e)}
                    disabled={isPending}
                    aria-label={onList ? "Remove from watchlist" : "Add to watchlist"}
                    className={`inline-flex items-center justify-center w-8 h-8 rounded transition-colors ${
                      onList
                        ? "text-[#F97316] hover:bg-orange-50"
                        : "text-[#9CA3AF] hover:text-[#F97316] hover:bg-orange-50"
                    } ${isPending ? "opacity-50 cursor-wait" : ""}`}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={onList ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
                    </svg>
                  </button>
                </td>
              </tr>
            );
          }}
        />
      </div>

      {perspective === "opportunity" && (
        <p className="text-[11px] text-[#6B7280]">
          * Competition and Affordability filters are stubbed in this release.
          Competition requires a builder→market mapping that StrategemOps
          doesn&apos;t carry; Affordability requires the FHFA House Price
          Index pipeline scheduled for the next release. Both render as
          em-dash until their data lands.
        </p>
      )}
    </div>
  );
}
