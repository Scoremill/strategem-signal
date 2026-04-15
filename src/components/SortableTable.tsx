"use client";

import { useState, useMemo } from "react";

interface Column {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  /**
   * Optional explanatory tooltip shown when the user hovers the
   * header. Renders as a native browser title attribute — no JS,
   * no positioning logic, instant feedback. Use for columns where
   * the header label alone is ambiguous (filter definitions, score
   * scales, etc.).
   */
  tooltip?: string;
}

interface SortableTableProps {
  columns: Column[];
  data: Record<string, unknown>[];
  renderRow: (row: Record<string, unknown>, index: number) => React.ReactNode;
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
}

export default function SortableTable({
  columns,
  data,
  renderRow,
  defaultSortKey,
  defaultSortDir = "desc",
}: SortableTableProps) {
  const [sortKey, setSortKey] = useState(defaultSortKey || "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);

  const sorted = useMemo(() => {
    if (!sortKey) return data;

    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];

      // Handle nulls
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      // Numeric comparison
      const an = typeof av === "string" ? parseFloat(av) : Number(av);
      const bn = typeof bv === "string" ? parseFloat(bv) : Number(bv);

      if (!isNaN(an) && !isNaN(bn)) {
        return sortDir === "asc" ? an - bn : bn - an;
      }

      // String comparison
      const as = String(av);
      const bs = String(bv);
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [data, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const alignClass = (a?: string) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  // overflow-visible (not overflow-x-auto) so absolute-positioned
  // tooltips inside header cells aren't clipped when they extend
  // below the header row. On narrow viewports the table will
  // horizontally scroll via the body's natural overflow rather
  // than a wrapper. If a future table needs horizontal scrolling
  // AND tooltips, we'll need a portal-based tooltip.
  return (
    <div className="overflow-visible">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {columns.map((col) => {
              const hasTooltip = !!col.tooltip;
              // Anchor the tooltip relative to the container centered
              // under the label. Tailwind `group-hover` + `peer-focus`
              // give us instant show with no JS and no browser delay.
              // transform translate-x centers by half the tooltip width.
              return (
                <th
                  key={col.key}
                  className={`py-3 px-3 sm:px-5 font-medium text-[#6B7280] ${alignClass(col.align)} ${
                    col.sortable !== false ? "cursor-pointer select-none hover:text-[#1E293B] transition-colors" : ""
                  }`}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                >
                  <span className={`relative inline-flex items-center gap-1 ${hasTooltip ? "group" : ""}`}>
                    <span className={hasTooltip ? "underline decoration-dotted decoration-[#9CA3AF] underline-offset-4" : ""}>
                      {col.label}
                    </span>
                    {hasTooltip && (
                      <>
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-[#9CA3AF] flex-shrink-0"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="16" x2="12" y2="12" />
                          <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 px-3 py-2 bg-[#1E293B] text-white text-[11px] font-normal leading-snug rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 whitespace-normal text-left normal-case tracking-normal"
                        >
                          <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#1E293B] rotate-45" />
                          {col.tooltip}
                        </span>
                      </>
                    )}
                    {col.sortable !== false && sortKey === col.key && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="currentColor"
                        className={`transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`}
                      >
                        <path d="M6 8L2 4h8L6 8z" />
                      </svg>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((row, i) => renderRow(row, i))}
        </tbody>
      </table>
    </div>
  );
}
