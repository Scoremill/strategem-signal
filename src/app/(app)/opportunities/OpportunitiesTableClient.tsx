"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import SortableTable from "@/components/SortableTable";
import { toggleWatchlistMarket } from "../settings/actions";

export interface OpportunityRow {
  id: string;
  shortName: string;
  state: string;
  filter1: number | null;
  filter2: number | null;
  filter3: number | null;
  filter4: number | null; // STUB
  filter5: number | null; // STUB
  filter6: number | null;
  numGreen: number;
  snapshotDate: string | null;
  onWatchlist: boolean;
}

interface OpportunitiesTableClientProps {
  rows: OpportunityRow[];
}

/**
 * Classify a filter score for coloring the cell. null (missing data
 * or stub) renders as "—", scores below 60 are amber, 60+ are the
 * green-pass band matching the heatmap.
 */
function scoreCellClass(score: number | null): string {
  if (score == null) return "text-[#9CA3AF] tabular-nums";
  if (score >= 60) return "text-emerald-700 font-semibold tabular-nums";
  return "text-[#4B5563] tabular-nums";
}

function numGreenBadgeClass(n: number): string {
  if (n >= 4) return "bg-emerald-100 text-emerald-800 font-bold";
  if (n === 3) return "bg-emerald-50 text-emerald-700 font-semibold";
  if (n === 2) return "bg-amber-50 text-amber-700 font-medium";
  if (n === 1) return "bg-gray-100 text-gray-600";
  return "bg-gray-100 text-gray-500";
}

export default function OpportunitiesTableClient({ rows }: OpportunitiesTableClientProps) {
  // Client-side optimistic watchlist toggle — server action handles
  // persistence, we flip the row-level flag immediately so the UI
  // feels responsive without waiting for the round-trip.
  const [localWatchlist, setLocalWatchlist] = useState<Record<string, boolean>>(
    () => {
      const init: Record<string, boolean> = {};
      for (const r of rows) init[r.id] = r.onWatchlist;
      return init;
    }
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleToggle(rowId: string) {
    const next = !localWatchlist[rowId];
    setLocalWatchlist((prev) => ({ ...prev, [rowId]: next }));
    setPendingId(rowId);
    startTransition(async () => {
      const result = await toggleWatchlistMarket(rowId, next);
      if (!result.ok) {
        // Revert on failure
        setLocalWatchlist((prev) => ({ ...prev, [rowId]: !next }));
      }
      setPendingId(null);
    });
  }

  const columns = [
    { key: "shortName", label: "Market", align: "left" as const },
    { key: "state", label: "State", align: "left" as const },
    { key: "numGreen", label: "Green", align: "center" as const },
    { key: "filter1", label: "Migration", align: "right" as const },
    { key: "filter2", label: "Diversity", align: "right" as const },
    { key: "filter3", label: "Imbalance", align: "right" as const },
    { key: "filter4", label: "Competition*", align: "right" as const },
    { key: "filter5", label: "Affordability*", align: "right" as const },
    { key: "filter6", label: "Operational", align: "right" as const },
    { key: "watchlist", label: "", align: "center" as const, sortable: false },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <SortableTable
          columns={columns}
          data={rows as unknown as Record<string, unknown>[]}
          defaultSortKey="numGreen"
          defaultSortDir="desc"
          renderRow={(row, i) => {
            const r = row as unknown as OpportunityRow;
            const onList = localWatchlist[r.id] ?? false;
            const isPending = pendingId === r.id;
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
                <td className="py-3 px-3 sm:px-5 text-center">
                  <span
                    className={`inline-flex items-center justify-center w-8 h-6 rounded text-[12px] tabular-nums ${numGreenBadgeClass(r.numGreen)}`}
                  >
                    {r.numGreen}/6
                  </span>
                </td>
                <td className={`py-3 px-3 sm:px-5 text-right text-sm ${scoreCellClass(r.filter1)}`}>
                  <Link href={`/opportunities/${r.id}/filter/1`} className="hover:underline">
                    {r.filter1 != null ? r.filter1.toFixed(0) : "—"}
                  </Link>
                </td>
                <td className={`py-3 px-3 sm:px-5 text-right text-sm ${scoreCellClass(r.filter2)}`}>
                  <Link href={`/opportunities/${r.id}/filter/2`} className="hover:underline">
                    {r.filter2 != null ? r.filter2.toFixed(0) : "—"}
                  </Link>
                </td>
                <td className={`py-3 px-3 sm:px-5 text-right text-sm ${scoreCellClass(r.filter3)}`}>
                  <Link href={`/opportunities/${r.id}/filter/3`} className="hover:underline">
                    {r.filter3 != null ? r.filter3.toFixed(0) : "—"}
                  </Link>
                </td>
                <td className={`py-3 px-3 sm:px-5 text-right text-sm ${scoreCellClass(r.filter4)}`}>
                  <Link href={`/opportunities/${r.id}/filter/4`} className="hover:underline">
                    {r.filter4 != null ? r.filter4.toFixed(0) : "—"}
                  </Link>
                </td>
                <td className={`py-3 px-3 sm:px-5 text-right text-sm ${scoreCellClass(r.filter5)}`}>
                  <Link href={`/opportunities/${r.id}/filter/5`} className="hover:underline">
                    {r.filter5 != null ? r.filter5.toFixed(0) : "—"}
                  </Link>
                </td>
                <td className={`py-3 px-3 sm:px-5 text-right text-sm ${scoreCellClass(r.filter6)}`}>
                  <Link href={`/opportunities/${r.id}/filter/6`} className="hover:underline">
                    {r.filter6 != null ? r.filter6.toFixed(0) : "—"}
                  </Link>
                </td>
                <td className="py-3 px-2 text-center">
                  <button
                    type="button"
                    onClick={() => handleToggle(r.id)}
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
      <p className="text-[11px] text-[#6B7280]">
        * Competition and Affordability filters are stubbed in this release.
        Competition requires a builder→market mapping StrategemOps doesn&apos;t
        carry yet; Affordability requires the FHFA House Price Index pipeline
        scheduled for the next release. Both columns render as em-dash until
        their data lands.
      </p>
    </div>
  );
}
