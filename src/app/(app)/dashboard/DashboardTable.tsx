"use client";

import Link from "next/link";
import SortableTable from "@/components/SortableTable";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  constrained: { bg: "bg-red-100", text: "text-red-800", label: "Constrained" },
  equilibrium: { bg: "bg-amber-100", text: "text-amber-800", label: "Balanced" },
  favorable: { bg: "bg-green-100", text: "text-green-800", label: "Favorable" },
};

const COLUMNS = [
  { key: "shortName", label: "Market", align: "left" as const },
  { key: "demandIndex", label: "Demand", align: "center" as const },
  { key: "capacityIndex", label: "Capacity", align: "center" as const },
  { key: "ratio", label: "D/C Ratio", align: "center" as const },
  { key: "statusSort", label: "Status", align: "center" as const },
  { key: "permits", label: "Permits/Mo", align: "right" as const },
  { key: "estStarts", label: "Est. Starts/Mo", align: "right" as const },
  { key: "employment", label: "Employment", align: "right" as const },
  { key: "unemploymentRate", label: "Unemp Rate", align: "right" as const },
];

export interface DashboardRow {
  id: string;
  shortName: string;
  state: string;
  demandIndex: number | null;
  capacityIndex: number | null;
  ratio: number | null;
  status: string | null;
  statusSort: number;
  permits: number | null;
  singleFamily: number | null;
  estStarts: number | null;
  employment: number | null;
  unemploymentRate: number | null;
}

export default function DashboardTable({ rows }: { rows: DashboardRow[] }) {
  return (
    <SortableTable
      columns={COLUMNS}
      data={rows as unknown as Record<string, unknown>[]}
      defaultSortKey="ratio"
      defaultSortDir="asc"
      renderRow={(row) => {
        const r = row as unknown as DashboardRow;
        const style = r.status ? STATUS_STYLES[r.status] : null;

        return (
          <tr key={r.id} className="hover:bg-gray-50 transition-colors">
            <td className="py-3 px-5 font-medium text-[#1E293B]">
              <Link href={`/geographies/${r.id}`} className="hover:text-[#F97316] transition-colors">
                {r.shortName}
              </Link>
              <span className="text-xs text-[#6B7280] ml-2">{r.state}</span>
            </td>
            <td className="py-3 px-5 text-center">
              {r.demandIndex !== null ? (
                <span className="text-sm font-semibold text-[#1E293B]">{r.demandIndex}</span>
              ) : "—"}
            </td>
            <td className="py-3 px-5 text-center">
              {r.capacityIndex !== null ? (
                <span className="text-sm font-semibold text-[#1E293B]">{r.capacityIndex}</span>
              ) : "—"}
            </td>
            <td className="py-3 px-5 text-center">
              {r.ratio !== null ? (
                <span className={`text-sm font-bold ${
                  r.ratio > 1.15 ? "text-red-700" : r.ratio < 0.85 ? "text-green-700" : "text-amber-700"
                }`}>
                  {r.ratio.toFixed(2)}
                </span>
              ) : "—"}
            </td>
            <td className="py-3 px-5 text-center">
              {style ? (
                <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full ${style.bg} ${style.text}`}>
                  {style.label}
                </span>
              ) : (
                <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">Unscored</span>
              )}
            </td>
            <td className="py-3 px-5 text-right text-[#1E293B]">
              {r.permits !== null ? Math.round(r.permits).toLocaleString() : "—"}
            </td>
            <td className="py-3 px-5 text-right text-[#1E293B]">
              {r.estStarts !== null ? r.estStarts.toLocaleString() : "—"}
            </td>
            <td className="py-3 px-5 text-right text-[#1E293B]">
              {r.employment !== null ? (r.employment / 1000).toFixed(0) + "K" : "—"}
            </td>
            <td className="py-3 px-5 text-right text-[#6B7280]">
              {r.unemploymentRate !== null ? `${r.unemploymentRate}%` : "—"}
            </td>
          </tr>
        );
      }}
    />
  );
}
