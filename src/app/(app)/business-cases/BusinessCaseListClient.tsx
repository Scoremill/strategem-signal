"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  toggleShareBusinessCase,
  deleteBusinessCase,
} from "../markets/[id]/business-case/actions";
import type { SavedCaseRow } from "./page";

interface Props {
  mine: SavedCaseRow[];
  shared: SavedCaseRow[];
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(1)}%`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function BusinessCaseListClient({ mine, shared }: Props) {
  if (mine.length === 0 && shared.length === 0) return null;
  return (
    <div className="space-y-8">
      {mine.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#6B7280] mb-3">
            My cases ({mine.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mine.map((c) => (
              <CaseCard key={c.id} caseRow={c} />
            ))}
          </div>
        </section>
      )}
      {shared.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#6B7280] mb-3">
            Shared by teammates ({shared.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {shared.map((c) => (
              <CaseCard key={c.id} caseRow={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CaseCard({ caseRow }: { caseRow: SavedCaseRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const recLabel =
    caseRow.recommendation === "organic"
      ? "Lean Organic"
      : caseRow.recommendation === "acquisition"
      ? "Lean Acquisition"
      : caseRow.recommendation === "pass"
      ? "Pass"
      : "—";
  const recColor =
    caseRow.recommendation === "organic"
      ? "bg-[#FFF7ED] text-[#9A3412]"
      : caseRow.recommendation === "acquisition"
      ? "bg-[#EFF6FF] text-[#1E3A5F]"
      : "bg-[#FEF2F2] text-[#991B1B]";

  function handleToggleShare() {
    start(async () => {
      const r = await toggleShareBusinessCase(caseRow.id, !caseRow.shared);
      if (r.ok) router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(`Delete "${caseRow.title}"? This cannot be undone.`)) return;
    start(async () => {
      const r = await deleteBusinessCase(caseRow.id);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 hover:border-[#F97316] transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <Link
            href={`/markets/${caseRow.geographyId}/business-case`}
            className="text-sm font-bold text-[#1E293B] hover:text-[#F97316] transition-colors block truncate"
          >
            {caseRow.title}
          </Link>
          <p className="text-[11px] text-[#6B7280] mt-0.5 truncate">
            {caseRow.marketLabel} · saved {fmtDate(caseRow.createdAt)}
            {!caseRow.isMine && caseRow.authorName && (
              <> · by {caseRow.authorName}</>
            )}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${recColor}`}
        >
          {recLabel}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-gray-100">
        <Metric
          label="Capital / unit"
          value={fmtMoney(caseRow.organic?.blendedCapitalPerUnit)}
        />
        <Metric
          label="Margin"
          value={fmtPct(caseRow.organic?.blendedGrossMarginPct)}
        />
        <Metric
          label="Year-one"
          value={fmtMoney(caseRow.organic?.yearOneCapitalDeployed)}
        />
      </div>

      {caseRow.notes && (
        <p className="mt-3 pt-3 border-t border-gray-100 text-xs text-[#6B7280] line-clamp-3">
          {caseRow.notes}
        </p>
      )}

      {caseRow.isMine && (
        <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={handleToggleShare}
            disabled={pending}
            className={`text-[11px] font-semibold transition-colors ${
              caseRow.shared
                ? "text-[#10B981] hover:text-[#059669]"
                : "text-[#6B7280] hover:text-[#1E293B]"
            }`}
          >
            {caseRow.shared ? "✓ Shared with org" : "Share with org"}
          </button>
          <button
            onClick={handleDelete}
            disabled={pending}
            className="text-[11px] text-[#6B7280] hover:text-[#EF4444] transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-[#6B7280]">{label}</p>
      <p className="text-sm font-bold text-[#1E293B] mt-0.5">{value}</p>
    </div>
  );
}
