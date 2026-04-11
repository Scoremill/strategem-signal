"use client";

import { useState, useMemo } from "react";

interface Column {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  sortable?: boolean;
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`py-3 px-5 font-medium text-[#6B7280] ${alignClass(col.align)} ${
                  col.sortable !== false ? "cursor-pointer select-none hover:text-[#1E293B] transition-colors" : ""
                }`}
                onClick={() => col.sortable !== false && handleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
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
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((row, i) => renderRow(row, i))}
        </tbody>
      </table>
    </div>
  );
}
