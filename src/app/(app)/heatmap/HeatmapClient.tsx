"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

interface MarketPoint {
  id: string;
  shortName: string;
  state: string;
  lat: number;
  lng: number;
  demandIndex: number | null;
  capacityIndex: number | null;
  ratio: number | null;
  status: string | null;
  permits: number | null;
  tradeWorkers: number | null;
}

type MetricView = "ratio" | "demand" | "capacity";

function getColor(value: number | null, metric: MetricView): string {
  if (value === null) return "#9CA3AF";

  if (metric === "ratio") {
    if (value > 1.5) return "#DC2626";  // deep red
    if (value > 1.15) return "#EF4444"; // red
    if (value > 0.85) return "#EAB308"; // yellow
    if (value > 0.6) return "#22C55E";  // green
    return "#16A34A";                    // deep green
  }

  // For demand/capacity: 0-100 scale
  if (value >= 70) return "#DC2626";
  if (value >= 50) return "#EAB308";
  if (value >= 30) return "#22C55E";
  return "#16A34A";
}

function getSize(value: number | null, metric: MetricView): number {
  if (value === null) return 32;
  if (metric === "ratio") return Math.max(32, Math.min(52, value * 18));
  return Math.max(32, Math.min(52, (value / 100) * 52));
}

export default function HeatmapClient({ markets }: { markets: MarketPoint[] }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [metric, setMetric] = useState<MetricView>("ratio");

  function getValue(m: MarketPoint, met: MetricView): number | null {
    if (met === "ratio") return m.ratio;
    if (met === "demand") return m.demandIndex;
    return m.capacityIndex;
  }

  function getLabel(met: MetricView): string {
    if (met === "ratio") return "D/C Ratio";
    if (met === "demand") return "Demand Index";
    return "Capacity Index";
  }

  useEffect(() => {
    if (!mapContainer.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;

    mapboxgl.accessToken = token;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [-96, 33],
      zoom: 4.2,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    return () => {
      map.current?.remove();
    };
  }, []);

  // Update markers when metric changes
  useEffect(() => {
    if (!map.current) return;

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const m of markets) {
      const value = getValue(m, metric);
      const color = getColor(value, metric);
      const size = getSize(value, metric);

      // Create marker element
      const el = document.createElement("div");
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderRadius = "50%";
      el.style.backgroundColor = color;
      el.style.opacity = "0.85";
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
      el.style.cursor = "pointer";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.color = "white";
      el.style.fontSize = "12px";
      el.style.fontWeight = "700";
      el.style.textShadow = "0 1px 2px rgba(0,0,0,0.5)";
      el.style.lineHeight = "1";

      if (value !== null) {
        el.textContent = metric === "ratio" ? value.toFixed(1) : String(Math.round(value));
      }

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([m.lng, m.lat])
        .addTo(map.current!);

      // Popup on click — lazy-load narrative snippet
      el.addEventListener("click", async () => {
        popupRef.current?.remove();

        const statusLabel = m.status === "constrained" ? "Constrained" : m.status === "equilibrium" ? "Balanced" : m.status === "favorable" ? "Favorable" : "Unscored";
        const statusColor = m.status === "constrained" ? "#DC2626" : m.status === "equilibrium" ? "#D97706" : m.status === "favorable" ? "#16A34A" : "#6B7280";

        // Show popup immediately with loading indicator
        const buildHtml = (snippet?: string) => `
          <div style="font-family: system-ui; min-width: 220px;">
            <div style="font-weight: 700; font-size: 14px; color: #1E293B; margin-bottom: 4px;">${m.shortName}, ${m.state}</div>
            <div style="display: inline-block; background: ${statusColor}22; color: ${statusColor}; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; margin-bottom: 8px;">${statusLabel}</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 12px; color: #4B5563;">
              <div>Demand: <strong style="color: #1E293B;">${m.demandIndex ?? "—"}</strong></div>
              <div>Capacity: <strong style="color: #1E293B;">${m.capacityIndex ?? "—"}</strong></div>
              <div>Ratio: <strong style="color: ${statusColor};">${m.ratio?.toFixed(2) ?? "—"}</strong></div>
              <div>Permits: <strong style="color: #1E293B;">${m.permits?.toLocaleString() ?? "—"}</strong></div>
              <div>Trade Workers: <strong style="color: #1E293B;">${m.tradeWorkers?.toLocaleString() ?? "—"}</strong></div>
            </div>
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #E5E7EB; font-size: 11px; color: #4B5563; line-height: 1.4;">
              ${snippet || '<span style="color: #9CA3AF;">Loading intelligence...</span>'}
            </div>
          </div>
        `;

        popupRef.current = new mapboxgl.Popup({ offset: 15, maxWidth: "300px" })
          .setLngLat([m.lng, m.lat])
          .setHTML(buildHtml())
          .addTo(map.current!);

        // Fetch narrative snippet
        try {
          const res = await fetch(`/api/narrative/${m.id}`);
          if (res.ok) {
            const data = await res.json();
            if (data.snippet && popupRef.current) {
              popupRef.current.setHTML(buildHtml(data.snippet));
            }
          }
        } catch {
          // silently fail — popup still shows data
        }
      });

      markersRef.current.push(marker);
    }
  }, [metric, markets]);

  return (
    <div className="relative h-full">
      {/* Metric toggle */}
      <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg border border-gray-200 p-1 flex gap-1">
        {(["ratio", "demand", "capacity"] as MetricView[]).map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              metric === m
                ? "bg-[#F97316] text-white"
                : "text-[#4B5563] hover:bg-gray-100"
            }`}
          >
            {getLabel(m)}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="absolute bottom-6 left-4 z-10 bg-white rounded-lg shadow-lg border border-gray-200 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#1E293B] mb-3">
          {getLabel(metric)}
        </p>
        {metric === "ratio" ? (
          <div className="flex items-center gap-4 text-sm text-[#1E293B]">
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#16A34A]" /> &lt;0.6</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#22C55E]" /> 0.6–0.85</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#D97706]" /> 0.85–1.15</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#EF4444]" /> 1.15–1.5</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#DC2626]" /> &gt;1.5</span>
          </div>
        ) : (
          <div className="flex items-center gap-4 text-sm text-[#1E293B]">
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#16A34A]" /> Low</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#22C55E]" /> Moderate</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#D97706]" /> High</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#DC2626]" /> Very High</span>
          </div>
        )}
      </div>

      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
}
