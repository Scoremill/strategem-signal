import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchLogs } from "@/lib/db/schema";
import { runMarketNarrativesPipeline } from "@/lib/pipelines/market-narratives-pipeline";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
// Vercel Hobby caps at 300s. The narrative generator runs ~2.5s per
// market × ~200 markets ≈ 500s which exceeds the cap. The pipeline is
// idempotent (ON CONFLICT DO UPDATE) so a partial run plus a retry is
// safe. A future revision can split into two batches if needed.
export const maxDuration = 300;

/**
 * Monthly market narratives refresh. Fires the day after portfolio-
 * health + market-opportunity cron runs so it picks up the freshest
 * snapshot data.
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
    const result = await runMarketNarrativesPipeline();
    const durationMs = Date.now() - startTime;

    await db.insert(fetchLogs).values({
      id: randomUUID(),
      pipeline: "market-narratives",
      recordsFetched: result.marketsProcessed,
      recordsNew: result.marketsGenerated,
      errors: result.errors.length > 0 ? JSON.stringify(result.errors.slice(0, 10)) : null,
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      marketsProcessed: result.marketsProcessed,
      marketsGenerated: result.marketsGenerated,
      marketsSkipped: result.marketsSkipped,
      errorCount: result.errors.length,
      durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/market-narratives] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
