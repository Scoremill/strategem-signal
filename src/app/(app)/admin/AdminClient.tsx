"use client";

import { useState } from "react";

interface FetchLogRow {
  id: string;
  pipeline: string;
  runAt: string;
  recordsFetched: number;
  recordsNew: number;
  errors: string | null;
  durationMs: number | null;
}

interface Alert {
  market: string;
  state: string;
  type: string;
  severity: string;
  message: string;
  value: number;
}

export default function AdminClient({
  logs,
  dataCounts,
}: {
  logs: FetchLogRow[];
  dataCounts: { permits: number; employment: number; population: number; capacity: number; scores: number };
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ pipeline: string; ok: boolean; message: string } | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [loadingAlerts, setLoadingAlerts] = useState(false);

  async function runPipeline(pipeline: string, backfill = false) {
    setRunning(pipeline);
    setLastResult(null);
    try {
      const url = `/api/cron/${pipeline}${backfill ? "?backfill=true" : ""}`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        const records = data.permits || data.recordsInserted || data.marketsScored || data.recordsFetched || 0;
        const duration = data.durationMs ? ` in ${(data.durationMs / 1000).toFixed(1)}s` : "";
        setLastResult({ pipeline, ok: true, message: `${pipeline} completed — ${records} records${duration}` });
      } else {
        setLastResult({ pipeline, ok: false, message: data.error || "Unknown error" });
      }
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setLastResult({ pipeline, ok: false, message: `Failed: ${err}` });
    } finally {
      setRunning(null);
    }
  }

  async function loadAlerts() {
    setLoadingAlerts(true);
    try {
      const res = await fetch("/api/alerts");
      if (res.ok) setAlerts((await res.json()).alerts);
    } catch {
      // silently fail
    } finally {
      setLoadingAlerts(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Data Health */}
      <div>
        <h2 className="text-lg font-bold text-[#1E293B] mb-4">Data Health</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Permit Records", value: dataCounts.permits },
            { label: "Employment Records", value: dataCounts.employment },
            { label: "Population Records", value: dataCounts.population },
            { label: "Capacity Records", value: dataCounts.capacity },
            { label: "Score Records", value: dataCounts.scores },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{item.label}</p>
              <p className="text-2xl font-bold text-[#1E293B] mt-1">{item.value.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pipeline Result Banner */}
      {lastResult && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
          lastResult.ok ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"
        }`}>
          {lastResult.ok ? "✓" : "✗"} {lastResult.message}
        </div>
      )}

      {/* Manual Triggers */}
      <div>
        <h2 className="text-lg font-bold text-[#1E293B] mb-4">Manual Pipeline Triggers</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => runPipeline("demand")}
            disabled={running !== null}
            className="px-4 py-2 bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {running === "demand" ? "Running..." : "Fetch Demand Data"}
          </button>
          <button
            onClick={() => runPipeline("capacity")}
            disabled={running !== null}
            className="px-4 py-2 bg-[#F97316] hover:bg-[#EA580C] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {running === "capacity" ? "Running..." : "Fetch Capacity Data"}
          </button>
          <button
            onClick={() => runPipeline("score")}
            disabled={running !== null}
            className="px-4 py-2 bg-[#1E293B] hover:bg-[#334155] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {running === "score" ? "Running..." : "Run Scoring Engine"}
          </button>
          <a
            href="/api/export"
            className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-[#1E293B] text-sm font-medium rounded-lg transition-colors"
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* Alerts */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-lg font-bold text-[#1E293B]">Capacity Alerts</h2>
          <button
            onClick={loadAlerts}
            disabled={loadingAlerts}
            className="text-xs text-[#F97316] hover:text-[#EA580C] font-medium"
          >
            {loadingAlerts ? "Loading..." : alerts ? "Refresh" : "Load Alerts"}
          </button>
        </div>
        {alerts && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {alerts.length === 0 ? (
              <div className="p-8 text-center text-[#6B7280]">No active alerts</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {alerts.map((alert, i) => (
                  <div key={i} className="px-5 py-3 flex items-start gap-3">
                    <span
                      className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                        alert.severity === "critical" ? "bg-red-500" : "bg-yellow-500"
                      }`}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#1E293B]">
                          {alert.market}, {alert.state}
                        </span>
                        <span
                          className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                            alert.severity === "critical"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-700"
                          }`}
                        >
                          {alert.severity}
                        </span>
                      </div>
                      <p className="text-xs text-[#6B7280] mt-0.5">{alert.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pipeline History */}
      <div>
        <h2 className="text-lg font-bold text-[#1E293B] mb-4">Pipeline Run History</h2>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-5 font-medium text-[#6B7280]">Pipeline</th>
                <th className="text-left py-3 px-5 font-medium text-[#6B7280]">Run At</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Records</th>
                <th className="text-right py-3 px-5 font-medium text-[#6B7280]">Duration</th>
                <th className="text-center py-3 px-5 font-medium text-[#6B7280]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="py-3 px-5 font-medium text-[#1E293B] capitalize">{log.pipeline}</td>
                  <td className="py-3 px-5 text-[#6B7280]">
                    {new Date(log.runAt).toLocaleString("en-US", {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                  </td>
                  <td className="py-3 px-5 text-right text-[#1E293B]">{log.recordsFetched}</td>
                  <td className="py-3 px-5 text-right text-[#6B7280]">
                    {log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="py-3 px-5 text-center">
                    {log.errors ? (
                      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                        Errors
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                        Success
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#6B7280]">No pipeline runs yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
