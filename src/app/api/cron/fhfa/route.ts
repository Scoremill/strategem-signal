import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchLogs } from "@/lib/db/schema";
import { runFhfaPipeline } from "@/lib/pipelines/fhfa-pipeline";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Monthly FHFA House Price Index refresh.
 *
 * Fires from .github/workflows/fhfa.yml on the 22nd of each month at
 * 6:30 AM CT (15 min after market-opportunity). The pipeline pulls the
 * full metro CSV and upserts rows into fhfa_hpi for every active
 * geography. minYear defaults to 2023 so the monthly cron only writes
 * the recent quarters — one-off historical backfill uses minYear=1975.
 */
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCron = auth && cronSecret && auth === `Bearer ${cronSecret}`;
  const cookie = request.cookies.get("ss_session")?.value;

  if (!isCron && !cookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const result = await runFhfaPipeline({ minYear: 2023 });
    const durationMs = Date.now() - startTime;

    await db.insert(fetchLogs).values({
      id: randomUUID(),
      pipeline: "fhfa",
      recordsFetched: result.marketsProcessed,
      recordsNew: result.rowsInserted,
      errors: result.errors.length > 0 ? JSON.stringify(result.errors.slice(0, 10)) : null,
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      marketsProcessed: result.marketsProcessed,
      marketsWithData: result.marketsWithData,
      rowsInserted: result.rowsInserted,
      errorCount: result.errors.length,
      durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/fhfa] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
