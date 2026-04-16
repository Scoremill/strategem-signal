"use client";

/**
 * Small info icon button that opens a ViewSourcesModal with the
 * supplied traces. Intended to sit inline next to any score, tile,
 * or output number so the CEO is always one click away from the
 * provenance of that number.
 */
import { useState } from "react";
import type { DisplaySourceTrace } from "@/lib/sources/traces";
import ViewSourcesModal from "./ViewSourcesModal";

export interface SourceButtonProps {
  title: string;
  subtitle?: string;
  traces: DisplaySourceTrace[];
  /** Tailwind size class. Default "w-4 h-4" reads small alongside text. */
  sizeClass?: string;
  /** Aria label for screen readers. */
  ariaLabel?: string;
}

export default function SourceButton({
  title,
  subtitle,
  traces,
  sizeClass = "w-4 h-4",
  ariaLabel = "View sources",
}: SourceButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        aria-label={ariaLabel}
        title={ariaLabel}
        className="inline-flex items-center justify-center rounded-full text-[#9CA3AF] hover:text-[#F97316] transition-colors"
      >
        <svg
          className={sizeClass}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7v3.5M8 5v0.01" strokeLinecap="round" />
        </svg>
      </button>
      <ViewSourcesModal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        subtitle={subtitle}
        traces={traces}
      />
    </>
  );
}
