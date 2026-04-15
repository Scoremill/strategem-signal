import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchLogs } from "@/lib/db/schema";
import { runZillowZhviPipeline } from "@/lib/pipelines/zillow-zhvi-pipeline";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Monthly Zillow ZHVI refresh. Fires on the 17th (Zillow publishes
 * on the 15th, we give it 48 hours for any late revisions).
 *
 * The cron only writes the last 3 months per market to keep runs fast
 * (a full history rewrite isn't needed — history doesn't change, just
 * the newest month lands). minDate defaults to 90 days ago.
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
  // 90 days back to catch the last 3 months — covers mid-cycle revisions
  // and lets us fill any gap left by a previous failed run.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const minDate = cutoff.toISOString().slice(0, 10);

  try {
    const result = await runZillowZhviPipeline({ minDate });
    const durationMs = Date.now() - startTime;

    await db.insert(fetchLogs).values({
      id: randomUUID(),
      pipeline: "zillow-zhvi",
      recordsFetched: result.marketsProcessed,
      recordsNew: result.rowsInserted,
      errors: result.errors.length > 0 ? JSON.stringify(result.errors.slice(0, 10)) : null,
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      marketsProcessed: result.marketsProcessed,
      marketsMatched: result.marketsMatched,
      rowsInserted: result.rowsInserted,
      unmatchedCount: result.unmatched.length,
      errorCount: result.errors.length,
      durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/zillow-zhvi] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
