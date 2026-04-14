"use client";

import { useEffect, useMemo, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { WeightPreset } from "@/lib/scoring/weight-presets";

export interface MarketHealthPoint {
  id: string;
  shortName: string;
  state: string;
  lat: number;
  lng: number;
  isTracked: boolean;
  financial: number | null;
  demand: number | null;
  operational: number | null;
  snapshotDate: string | null;
}

interface HeatmapClientProps {
  markets: MarketHealthPoint[];
  preset: WeightPreset;
  /** When true, render every market (no filter set). When false, the
   *  untracked markets render as small gray dots so the map still has
   *  geographic context. */
  showAllMarkets: boolean;
}

/**
 * Blend the three sub-scores into a composite using the user's chosen
 * preset. If a sub-score is missing, its weight is redistributed across
 * the remaining sub-scores so a null Financial doesn't silently deflate
 * the composite. Matches the server-side scorer's missing-data policy.
 */
function blendComposite(
  financial: number | null,
  demand: number | null,
  operational: number | null,
  weights: WeightPreset["weights"]
): number | null {
  const parts: Array<[number, number]> = [];
  if (financial != null) parts.push([financial, weights.financial]);
  if (demand != null) parts.push([demand, weights.demand]);
  if (operational != null) parts.push([operational, weights.operational]);
  if (parts.length === 0) return null;
  let sum = 0;
  let wsum = 0;
  for (const [score, w] of parts) {
    sum += score * w;
    wsum += w;
  }
  return wsum > 0 ? sum / wsum : null;
}

/**
 * Map a composite 0-100 score to a green→amber→red color stop.
 * High is good (green), low is bad (red). Null = gray (no data).
 */
function compositeColor(composite: number | null): string {
  if (composite == null) return "#9CA3AF";
  if (composite >= 65) return "#16A34A"; // deep green
  if (composite >= 55) return "#22C55E"; // green
  if (composite >= 45) return "#EAB308"; // yellow
  if (composite >= 35) return "#F97316"; // orange
  return "#DC2626"; // red
}

/**
 * Map composite score to marker size. Bigger = higher absolute score so
 * the eye can spot clustering faster.
 */
function compositeSize(composite: number | null): number {
  if (composite == null) return 24;
  return Math.max(28, Math.min(52, 28 + (composite / 100) * 24));
}

export default function HeatmapClient({
  markets,
  preset,
  showAllMarkets,
}: HeatmapClientProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  // Pre-compute composite for each market using the user's preset. Memo
  // so rebuilds only happen when the underlying data or preset changes.
  const pointsWithComposite = useMemo(
    () =>
      markets.map((m) => ({
        ...m,
        composite: blendComposite(m.financial, m.demand, m.operational, preset.weights),
      })),
    [markets, preset]
  );

  // Initialize Mapbox once.
  useEffect(() => {
    if (!mapContainer.current) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      console.warn("[heatmap] NEXT_PUBLIC_MAPBOX_TOKEN is not set");
      return;
    }
    mapboxgl.accessToken = token;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [-96, 37],
      zoom: 3.8,
    });
    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Create / refresh markers whenever the composite data changes.
  useEffect(() => {
    if (!map.current) return;

    // Clear previous markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // When a filter is set, dim untracked markets to small gray dots so
    // the geographic context stays visible without drawing attention.
    for (const m of pointsWithComposite) {
      const isPrimary = showAllMarkets || m.isTracked;
      const color = isPrimary ? compositeColor(m.composite) : "#D1D5DB";
      const size = isPrimary ? compositeSize(m.composite) : 14;

      const el = document.createElement("div");
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderRadius = "50%";
      el.style.backgroundColor = color;
      el.style.opacity = isPrimary ? "0.9" : "0.6";
      el.style.border = `2px solid ${isPrimary ? "white" : "#F3F4F6"}`;
      el.style.boxShadow = isPrimary ? "0 2px 6px rgba(0,0,0,0.3)" : "none";
      el.style.cursor = isPrimary ? "pointer" : "default";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.color = "white";
      el.style.fontSize = "11px";
      el.style.fontWeight = "700";
      el.style.textShadow = "0 1px 2px rgba(0,0,0,0.5)";
      el.style.lineHeight = "1";
      if (isPrimary && m.composite != null) {
        el.textContent = Math.round(m.composite).toString();
      }

      // Only primary markers get popups — context dots are visual only.
      let popup: mapboxgl.Popup | undefined;
      if (isPrimary) {
        const compositeLabel = m.composite != null ? m.composite.toFixed(0) : "—";
        const financialLabel = m.financial != null ? m.financial.toFixed(0) : "—";
        const demandLabel = m.demand != null ? m.demand.toFixed(0) : "—";
        const operationalLabel = m.operational != null ? m.operational.toFixed(0) : "—";
        const compositeColorValue = compositeColor(m.composite);
        popup = new mapboxgl.Popup({ offset: 15, maxWidth: "260px" }).setHTML(`
          <div style="font-family: system-ui; min-width: 220px;">
            <div style="font-weight: 700; font-size: 14px; color: #1E293B;">${m.shortName}, ${m.state}</div>
            <div style="margin-top: 6px; display: flex; align-items: center; gap: 8px;">
              <span style="display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: ${compositeColorValue}; color: white; font-size: 15px; font-weight: 700;">${compositeLabel}</span>
              <div>
                <div style="font-size: 11px; text-transform: uppercase; color: #6B7280; letter-spacing: 0.5px;">Composite</div>
                <div style="font-size: 11px; color: #4B5563;">${preset.label} weighting</div>
              </div>
            </div>
            <div style="margin-top: 10px; border-top: 1px solid #E5E7EB; padding-top: 8px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
              <div>
                <div style="font-size: 10px; text-transform: uppercase; color: #6B7280;">Financial</div>
                <div style="font-size: 14px; font-weight: 700; color: #1E293B;">${financialLabel}</div>
              </div>
              <div>
                <div style="font-size: 10px; text-transform: uppercase; color: #6B7280;">Demand</div>
                <div style="font-size: 14px; font-weight: 700; color: #1E293B;">${demandLabel}</div>
              </div>
              <div>
                <div style="font-size: 10px; text-transform: uppercase; color: #6B7280;">Operational</div>
                <div style="font-size: 14px; font-weight: 700; color: #1E293B;">${operationalLabel}</div>
              </div>
            </div>
            ${m.snapshotDate ? `<div style="margin-top: 8px; font-size: 10px; color: #9CA3AF;">Snapshot ${m.snapshotDate}</div>` : ""}
          </div>
        `);
      }

      const marker = new mapboxgl.Marker({ element: el }).setLngLat([m.lng, m.lat]);
      if (popup) marker.setPopup(popup);
      marker.addTo(map.current!);
      markersRef.current.push(marker);
    }
  }, [pointsWithComposite, showAllMarkets, preset]);

  return (
    <div className="relative h-full">
      {/* Legend */}
      <div className="absolute bottom-10 left-4 z-10 bg-white rounded-lg shadow-lg border border-gray-200 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#1E293B] mb-3">
          Portfolio Health Score
        </p>
        <div className="flex items-center gap-4 text-[11px] text-[#1E293B]">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#16A34A]" /> 65+</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#22C55E]" /> 55-65</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#EAB308]" /> 45-55</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#F97316]" /> 35-45</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#DC2626]" /> &lt;35</span>
        </div>
      </div>
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
}
