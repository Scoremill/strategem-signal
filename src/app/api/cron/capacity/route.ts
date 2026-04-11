import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchLogs } from "@/lib/db/schema";
import { runCapacityPipeline } from "@/lib/pipelines/capacity-pipeline";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes — backfill needs time for 15 MSAs x 8 quarters

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCron = auth && cronSecret && auth === `Bearer ${cronSecret}`;
  const cookie = request.cookies.get("ss_session")?.value;

  if (!isCron && !cookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const backfill = searchParams.get("backfill") === "true";

  const startTime = Date.now();

  try {
    const result = await runCapacityPipeline(backfill);
    const durationMs = Date.now() - startTime;

    await db.insert(fetchLogs).values({
      id: randomUUID(),
      pipeline: "capacity",
      recordsFetched: result.recordsInserted,
      recordsNew: result.recordsInserted,
      errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      backfill,
      recordsInserted: result.recordsInserted,
      quartersProcessed: result.quartersProcessed,
      errors: result.errors,
      durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/capacity] error:", msg);

    await db.insert(fetchLogs).values({
      id: randomUUID(),
      pipeline: "capacity",
      recordsFetched: 0,
      recordsNew: 0,
      errors: JSON.stringify([msg]),
      durationMs: Date.now() - startTime,
    });

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
