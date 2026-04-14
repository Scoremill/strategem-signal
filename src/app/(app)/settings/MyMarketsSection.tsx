"use client";

import { useMemo, useState, useTransition } from "react";
import { saveTrackedMarkets } from "./actions";

export interface MarketOption {
  id: string;
  shortName: string;
  state: string;
  population: number | null;
}

interface MyMarketsSectionProps {
  allMarkets: MarketOption[];
  initiallySelectedIds: string[];
}

const SOFT_CAP = 20;

export default function MyMarketsSection({
  allMarkets,
  initiallySelectedIds,
}: MyMarketsSectionProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initiallySelectedIds)
  );
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  const isDirty = useMemo(() => {
    if (selectedIds.size !== initiallySelectedIds.length) return true;
    for (const id of initiallySelectedIds) {
      if (!selectedIds.has(id)) return true;
    }
    return false;
  }, [selectedIds, initiallySelectedIds]);

  // Order: selected first (alphabetical), then unselected (by population desc),
  // then apply the search filter on top of that ordering.
  const orderedMarkets = useMemo(() => {
    const selected: MarketOption[] = [];
    const unselected: MarketOption[] = [];
    for (const m of allMarkets) {
      if (selectedIds.has(m.id)) selected.push(m);
      else unselected.push(m);
    }
    selected.sort((a, b) => a.shortName.localeCompare(b.shortName));
    unselected.sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
    return [...selected, ...unselected];
  }, [allMarkets, selectedIds]);

  const filteredMarkets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orderedMarkets;
    return orderedMarkets.filter(
      (m) =>
        m.shortName.toLowerCase().includes(q) ||
        m.state.toLowerCase().includes(q)
    );
  }, [orderedMarkets, search]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFeedback(null);
  }

  function clearAll() {
    setSelectedIds(new Set());
    setFeedback(null);
  }

  function handleSave() {
    setFeedback(null);
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      const result = await saveTrackedMarkets(ids);
      if (!result.ok) {
        setFeedback({ kind: "error", message: result.error });
        return;
      }
      const parts: string[] = [];
      if (result.added > 0) parts.push(`${result.added} added`);
      if (result.removed > 0) parts.push(`${result.removed} removed`);
      const summary = parts.length > 0 ? parts.join(", ") : "no changes";
      setFeedback({
        kind: "success",
        message: `Saved · ${result.total} market${result.total === 1 ? "" : "s"} in your filter (${summary})`,
      });
    });
  }

  const overSoftCap = selectedIds.size > SOFT_CAP;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#1E293B]">My Markets</h3>
          <p className="text-[11px] text-[#6B7280] mt-1">
            Pick the MSAs you care about. The Portfolio Health View scores only
            the markets in your filter. This is your personal list — your teammates
            each have their own.
          </p>
        </div>
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-orange-100 text-[#EA580C] flex-shrink-0">
          {selectedIds.size} selected
        </span>
      </div>

      {overSoftCap && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
          You have more than {SOFT_CAP} markets selected. The Portfolio Health
          View is designed for ~20 markets at a time — large filters still save,
          but the 10-second-read goal becomes harder.
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by city or state…"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 text-[#1E293B] placeholder:text-[#9CA3AF]"
          />
        </div>
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="px-3 py-2 text-[11px] font-medium text-[#6B7280] hover:text-[#1E293B] hover:bg-gray-50 rounded-lg transition-colors flex-shrink-0"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="border border-gray-200 rounded-lg max-h-[360px] overflow-y-auto divide-y divide-gray-100">
        {filteredMarkets.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-[#6B7280]">
            No markets match &ldquo;{search}&rdquo;
          </div>
        ) : (
          filteredMarkets.map((m) => {
            const isSelected = selectedIds.has(m.id);
            return (
              <label
                key={m.id}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                  isSelected ? "bg-orange-50 hover:bg-orange-100" : "hover:bg-gray-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(m.id)}
                  className="h-4 w-4 rounded border-gray-300 text-[#F97316] focus:ring-orange-200 focus:ring-2"
                />
                <div className="flex-1 min-w-0 flex items-baseline gap-2">
                  <span className="text-sm font-medium text-[#1E293B] truncate">
                    {m.shortName}
                  </span>
                  <span className="text-[11px] text-[#6B7280]">{m.state}</span>
                </div>
                {m.population != null && (
                  <span className="text-[11px] text-[#6B7280] tabular-nums flex-shrink-0">
                    {(m.population / 1_000_000).toFixed(1)}M
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {feedback && (
            <p
              className={`text-[11px] ${
                feedback.kind === "success" ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {feedback.message}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || isPending}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-[#F97316] text-white hover:bg-[#EA580C] disabled:bg-gray-200 disabled:text-[#9CA3AF] disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
