import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { fetchLogs } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!session.isSuperadmin && session.role !== "owner") {
    redirect("/heatmap");
  }

  const recentLogs = await db
    .select()
    .from(fetchLogs)
    .orderBy(desc(fetchLogs.runAt))
    .limit(10);

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1E293B]">Admin</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          System console — pipeline monitoring and data auditing.
        </p>
      </div>

      {/* Admin tools */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <Link
          href="/admin/data-health"
          className="bg-white rounded-xl border border-gray-200 p-5 hover:border-[#F97316] hover:shadow-sm transition-all group"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-orange-50 flex items-center justify-center group-hover:bg-orange-100 transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-[#1E293B]">
              Data Health Audit
            </h3>
          </div>
          <p className="text-xs text-[#6B7280]">
            Coverage matrix for every market across all 8 data sources.
            See which markets have gaps and which scores are built on
            incomplete data.
          </p>
        </Link>

        <div className="bg-white rounded-xl border border-gray-200 p-5 opacity-60">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-[#1E293B]">
              Pipeline Triggers
            </h3>
          </div>
          <p className="text-xs text-[#6B7280]">
            Manual pipeline triggers for demand, capacity, scoring, and
            narratives. Coming soon.
          </p>
        </div>
      </div>

      {/* Recent pipeline runs */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-[#1E293B] mb-3">
          Recent Pipeline Runs
        </h3>
        {recentLogs.length === 0 ? (
          <p className="text-xs text-[#6B7280]">No pipeline runs logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-2 py-1.5 font-semibold text-[#6B7280]">Pipeline</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-[#6B7280]">When</th>
                  <th className="text-right px-2 py-1.5 font-semibold text-[#6B7280]">Records</th>
                  <th className="text-right px-2 py-1.5 font-semibold text-[#6B7280]">Duration</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-[#6B7280]">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-50">
                    <td className="px-2 py-1.5 font-medium text-[#1E293B] capitalize">
                      {log.pipeline}
                    </td>
                    <td className="px-2 py-1.5 text-[#6B7280]">
                      {new Date(log.runAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-2 py-1.5 text-right text-[#1E293B] font-mono">
                      {log.recordsNew ?? log.recordsFetched ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right text-[#6B7280] font-mono">
                      {log.durationMs
                        ? (log.durationMs / 1000).toFixed(1) + "s"
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      {log.errors ? (
                        <span className="text-red-600 font-medium">Errors</span>
                      ) : (
                        <span className="text-emerald-600 font-medium">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
