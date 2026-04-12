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

  // Demand: high = hot (more demand pressure) → red
  if (metric === "demand") {
    if (value >= 70) return "#DC2626";
    if (value >= 50) return "#D97706";
    if (value >= 30) return "#22C55E";
    return "#16A34A";
  }

  // Capacity: high = good (more labor available) → green
  if (value >= 70) return "#16A34A";  // deep green — strong capacity
  if (value >= 50) return "#22C55E";  // green
  if (value >= 30) return "#D97706";  // amber — moderate capacity
  return "#DC2626";                    // red — weak capacity
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

      const statusLabel = m.status === "constrained" ? "Constrained" : m.status === "equilibrium" ? "Balanced" : m.status === "favorable" ? "Favorable" : "Unscored";
      const statusColor = m.status === "constrained" ? "#DC2626" : m.status === "equilibrium" ? "#D97706" : m.status === "favorable" ? "#16A34A" : "#6B7280";

      const popupHtml = `
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
          <div id="narrative-${m.id}" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #E5E7EB; font-size: 11px; color: #4B5563; line-height: 1.4;">
            <span style="color: #9CA3AF;">Loading intelligence...</span>
          </div>
        </div>
      `;

      const popup = new mapboxgl.Popup({ offset: 15, maxWidth: "300px" })
        .setHTML(popupHtml);

      // Fetch narrative when popup opens
      popup.on("open", async () => {
        try {
          const res = await fetch(`/api/narrative/${m.id}`, { credentials: "same-origin" });
          if (res.ok) {
            const data = await res.json();
            const el2 = document.getElementById(`narrative-${m.id}`);
            if (el2 && data.snippet) {
              el2.textContent = data.snippet;
              el2.style.color = "#4B5563";
            }
          }
        } catch {
          const el2 = document.getElementById(`narrative-${m.id}`);
          if (el2) el2.textContent = "";
        }
      });

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([m.lng, m.lat])
        .setPopup(popup)
        .addTo(map.current!);

      markersRef.current.push(marker);
    }
  }, [metric, markets]);

  return (
    <div className="relative h-full">
      {/* Metric toggle with tooltips */}
      <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg border border-gray-200 p-1 flex gap-1">
        {([
          {
            key: "ratio" as MetricView,
            label: "D/C Ratio",
            tooltip: "Demand-Capacity Ratio: Demand Index divided by Capacity Index. Above 1.15 means demand exceeds trade labor capacity — expect longer cycle times and cost pressure. Below 0.85 means capacity is available for builder expansion with trade pricing leverage.",
          },
          {
            key: "demand" as MetricView,
            label: "Demand Index",
            tooltip: "Demand Index (0–100): A composite score measuring housing demand strength from building permits, employment growth, population, and unemployment rate. Higher score = stronger demand for new construction in that market.",
          },
          {
            key: "capacity" as MetricView,
            label: "Capacity Index",
            tooltip: "Capacity Index (0–100): A composite score measuring trade labor availability from construction workforce size, wage acceleration (inverse — rising wages signal tightness), and contractor establishment counts. Higher score = more trade capacity available. A market can have strong demand (green) but low capacity (red) — that mismatch is the key risk signal.",
          },
        ]).map((m) => (
          <div key={m.key} className="relative group">
            <button
              onClick={() => setMetric(m.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                metric === m.key
                  ? "bg-[#F97316] text-white"
                  : "text-[#4B5563] hover:bg-gray-100"
              }`}
            >
              {m.label}
            </button>
            <div className="absolute top-full left-0 mt-2 w-72 bg-[#1E293B] text-white text-xs leading-relaxed rounded-lg p-3 shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none">
              {m.tooltip}
              <div className="absolute -top-1 left-4 w-2 h-2 bg-[#1E293B] rotate-45" />
            </div>
          </div>
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
        ) : metric === "demand" ? (
          <div className="flex items-center gap-4 text-sm text-[#1E293B]">
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#16A34A]" /> Low</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#22C55E]" /> Moderate</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#D97706]" /> High</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#DC2626]" /> Very High</span>
          </div>
        ) : (
          <div className="flex items-center gap-4 text-sm text-[#1E293B]">
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#DC2626]" /> Weak</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#D97706]" /> Moderate</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#22C55E]" /> Good</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full bg-[#16A34A]" /> Strong</span>
          </div>
        )}
      </div>

      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
}
