/**
 * Snapshot freshness status endpoint.
 *
 * Used by .github/workflows/ops-snapshot-retry.yml to decide whether the
 * self-heal cron needs to fire the snapshot endpoint. Returns:
 *
 *   {
 *     lastRun: ISO timestamp or null,
 *     ageHours: number,
 *     status: "success" | "partial" | "failed" | "never",
 *     needsRetry: boolean
 *   }
 *
 * needsRetry is true if:
 *   - status is "failed" or "never" (never run before)
 *   - OR ageHours > 35 * 24 (the snapshot is older than 35 days)
 *
 * Read-only, no auth required — exposes only timestamps and a boolean.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_THRESHOLD_HOURS = 35 * 24;

export async function GET() {
  try {
    const rows = await db.execute(sql`
      SELECT run_started_at, status
      FROM ops_snapshot_log
      ORDER BY run_started_at DESC
      LIMIT 1
    `);
    const row =
      (rows as unknown as { rows?: Array<{ run_started_at: string; status: string }> }).rows?.[0]
      ?? (Array.isArray(rows) ? (rows as Array<{ run_started_at: string; status: string }>)[0] : undefined);

    if (!row) {
      return NextResponse.json({
        lastRun: null,
        ageHours: null,
        status: "never",
        needsRetry: true,
      });
    }

    const lastRun = new Date(row.run_started_at);
    const ageHours = (Date.now() - lastRun.getTime()) / (1000 * 60 * 60);
    const needsRetry = row.status === "failed" || ageHours > STALE_THRESHOLD_HOURS;

    return NextResponse.json({
      lastRun: lastRun.toISOString(),
      ageHours: Math.round(ageHours * 10) / 10,
      status: row.status,
      needsRetry,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
