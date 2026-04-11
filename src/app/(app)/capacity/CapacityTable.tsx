"use client";

import SortableTable from "@/components/SortableTable";

const COLUMNS = [
  { key: "shortName", label: "Market", align: "left" as const },
  { key: "totalEmployment", label: "Trade Workers", align: "right" as const },
  { key: "totalEstablishments", label: "Establishments", align: "right" as const },
  { key: "avgWeeklyWage", label: "Avg Weekly Wage", align: "right" as const },
  { key: "avgWageYoy", label: "Wage Growth YoY", align: "right" as const },
  { key: "avgEmpYoy", label: "Emp Growth YoY", align: "right" as const },
];

export interface CapacityRow {
  id: string;
  shortName: string;
  totalEmployment: number | null;
  totalEstablishments: number | null;
  avgWeeklyWage: number | null;
  avgWageYoy: number | null;
  avgEmpYoy: number | null;
}

export default function CapacityTable({ rows }: { rows: CapacityRow[] }) {
  return (
    <SortableTable
      columns={COLUMNS}
      data={rows as unknown as Record<string, unknown>[]}
      defaultSortKey="totalEmployment"
      defaultSortDir="desc"
      renderRow={(row) => {
        const r = row as unknown as CapacityRow;
        const wageYoy = r.avgWageYoy ?? 0;
        const empYoy = r.avgEmpYoy ?? 0;

        return (
          <tr key={r.id} className="hover:bg-gray-50 transition-colors">
            <td className="py-3 px-5 font-medium text-[#1E293B]">{r.shortName}</td>
            <td className="py-3 px-5 text-right text-[#1E293B] font-medium">
              {r.totalEmployment !== null ? r.totalEmployment.toLocaleString() : "—"}
            </td>
            <td className="py-3 px-5 text-right text-[#6B7280]">
              {r.totalEstablishments !== null ? r.totalEstablishments.toLocaleString() : "—"}
            </td>
            <td className="py-3 px-5 text-right text-[#1E293B]">
              {r.avgWeeklyWage !== null ? `$${r.avgWeeklyWage.toLocaleString()}` : "—"}
            </td>
            <td className="py-3 px-5 text-right">
              <span className={`font-medium ${
                wageYoy > 5 ? "text-red-600" : wageYoy > 3 ? "text-yellow-600" : "text-green-600"
              }`}>
                {r.avgWageYoy !== null ? `${wageYoy > 0 ? "+" : ""}${wageYoy}%` : "—"}
              </span>
            </td>
            <td className="py-3 px-5 text-right">
              <span className={`font-medium ${
                empYoy > 0 ? "text-green-600" : empYoy < -2 ? "text-red-600" : "text-[#6B7280]"
              }`}>
                {r.avgEmpYoy !== null ? `${empYoy > 0 ? "+" : ""}${empYoy}%` : "—"}
              </span>
            </td>
          </tr>
        );
      }}
    />
  );
}
