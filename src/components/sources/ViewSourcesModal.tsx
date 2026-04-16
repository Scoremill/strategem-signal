"use client";

/**
 * View Sources modal — the CEO-facing traceability surface.
 *
 * Generic enough to render on any screen that can produce a
 * DisplaySourceTrace[]. Shows one row per traced data point with
 * value · label · source provider + URL · as-of date · optional
 * derivation. Closes on backdrop click or Escape.
 *
 * Rendered through a portal into document.body so it escapes any
 * parent overflow/transform contexts and floats correctly above the
 * whole page (same pattern the PDF template uses).
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { DisplaySourceTrace } from "@/lib/sources/traces";
import { formatTraceValue } from "@/lib/sources/traces";

export interface ViewSourcesModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  traces: DisplaySourceTrace[];
}

export default function ViewSourcesModal({
  open,
  onClose,
  title,
  subtitle,
  traces,
}: ViewSourcesModalProps) {
  // Close on Escape for keyboard accessibility
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-xl bg-white shadow-xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[#1E293B] truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-[#6B7280] mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-[#6B7280] hover:text-[#1E293B] hover:bg-gray-100 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {traces.length === 0 ? (
            <p className="text-sm text-[#6B7280]">
              No source data available for this item.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {traces.map((t, i) => (
                <li key={i} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#1E293B]">
                        {t.label}
                      </p>
                      {t.derivation && (
                        <p className="mt-0.5 text-[11px] text-[#6B7280] italic">
                          {t.derivation}
                        </p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#6B7280]">
                        <span>
                          Source:{" "}
                          <span className="text-[#1E293B] font-medium">
                            {t.source.provider
                              ? `${t.source.provider} · ${t.source.label}`
                              : t.source.label}
                          </span>
                        </span>
                        {t.asOf && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>As of {t.asOf}</span>
                          </>
                        )}
                      </div>
                      {t.source.url && (
                        <a
                          href={t.source.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-1 inline-block text-[11px] text-[#F97316] hover:text-[#EA580C] underline underline-offset-2"
                        >
                          View on {t.source.provider || "source"} →
                        </a>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-bold text-[#1E293B] tabular-nums">
                        {formatTraceValue(t.value, t.unit)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-[10px] text-[#6B7280] leading-snug">
            All source links open the authoritative upstream publisher.
            Numbers shown reflect the most recent data the pipelines
            ingested — refresh cadences vary by source.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
