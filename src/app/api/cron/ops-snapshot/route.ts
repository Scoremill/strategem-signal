/**
 * Monthly StrategemOps snapshot cron endpoint.
 *
 * Triggered by:
 *   - .github/workflows/ops-snapshot.yml — primary, 1st of each month at 11:00 UTC
 *   - .github/workflows/ops-snapshot-retry.yml — daily self-heal at 12:00 UTC,
 *     only fires this endpoint if the most recent snapshot is failed or stale
 *
 * Idempotent: safe to re-run immediately. Per-table error isolation means a
 * single broken table never blocks the other 13.
 */
import { NextRequest, NextResponse } from "next/server";
import { runOpsSnapshotPipeline } from "@/lib/pipelines/ops-snapshot-pipeline";

export const runtime = "nodejs";
// StrategemOps is small (~42 MB total) so the snapshot completes well under
// the Vercel Hobby 300s cap. If StrategemOps grows substantially we may need
// to chunk by table — for now the whole job runs in one invocation.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCron = auth && cronSecret && auth === `Bearer ${cronSecret}`;
  const cookie = request.cookies.get("ss_session")?.value;

  if (!isCron && !cookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runOpsSnapshotPipeline();
    // Return 200 even on partial — the snapshot ran, some tables landed,
    // the self-heal cron will retry the failed ones tomorrow. Only return
    // 500 on a hard failure (entire pipeline crashed before any table ran).
    return NextResponse.json({
      ok: true,
      status: result.status,
      totalRowsUpserted: result.totalRowsUpserted,
      durationMs: result.durationMs,
      tables: result.tables.map((t) => ({
        table: t.table,
        rowsFetched: t.rowsFetched,
        rowsUpserted: t.rowsUpserted,
        durationMs: t.durationMs,
        error: t.error,
      })),
      errors: result.errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/ops-snapshot] hard failure:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
