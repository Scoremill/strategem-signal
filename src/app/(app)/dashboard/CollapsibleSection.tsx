"use client";

import { useState } from "react";

interface CollapsibleSectionProps {
  collapsedHeight: number;
  children: React.ReactNode;
}

/**
 * Wraps a server-rendered child in a fixed-height container that the user
 * can expand to show all content. Used to keep long tables (52 markets) from
 * dominating the dashboard before the user has scanned the more compact
 * intelligence cards above.
 */
export default function CollapsibleSection({ collapsedHeight, children }: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-out"
        style={{ maxHeight: expanded ? 9999 : collapsedHeight }}
      >
        {children}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-3 text-xs font-semibold text-[#EA580C] hover:bg-orange-50 border-t border-gray-200 transition-colors flex items-center justify-center gap-1.5"
      >
        {expanded ? "Show fewer markets" : "Show all markets"}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </>
  );
}
