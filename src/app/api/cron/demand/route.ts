import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchLogs } from "@/lib/db/schema";
import { runDemandPipeline } from "@/lib/pipelines/demand-pipeline";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 120; // 2 minutes for backfill

export async function POST(request: NextRequest) {
  // Verify auth — cron secret or admin session
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCron = auth && cronSecret && auth === `Bearer ${cronSecret}`;

  // Also allow cookie-based admin access for manual triggers
  const cookie = request.cookies.get("ss_session")?.value;
  if (!isCron && !cookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const backfill = searchParams.get("backfill") === "true";

  const startTime = Date.now();

  try {
    const result = await runDemandPipeline(backfill);
    const durationMs = Date.now() - startTime;

    // Log the run
    await db.insert(fetchLogs).values({
      id: randomUUID(),
      pipeline: "demand",
      recordsFetched:
        result.permitsInserted + result.employmentInserted + result.populationInserted,
      recordsNew:
        result.permitsInserted + result.employmentInserted + result.populationInserted,
      errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      backfill,
      permits: result.permitsInserted,
      employment: result.employmentInserted,
      population: result.populationInserted,
      errors: result.errors,
      durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/demand] error:", msg);

    await db.insert(fetchLogs).values({
      id: randomUUID(),
      pipeline: "demand",
      recordsFetched: 0,
      recordsNew: 0,
      errors: JSON.stringify([msg]),
      durationMs: Date.now() - startTime,
    });

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
