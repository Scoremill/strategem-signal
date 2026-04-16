import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchLogs } from "@/lib/db/schema";
import { runMarketOpportunityPipeline } from "@/lib/pipelines/market-opportunity-pipeline";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Monthly six-filter market opportunity scoring job.
 *
 * Fires from .github/workflows/market-opportunity.yml on the 22nd of
 * each month (same window as the portfolio-health cron so both scores
 * snapshot from the same vintage of underlying data).
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
    const result = await runMarketOpportunityPipeline();
    const durationMs = Date.now() - startTime;

    await db.insert(fetchLogs).values({
      id: randomUUID(),
      pipeline: "market-opportunity",
      recordsFetched: result.marketsProcessed,
      recordsNew: result.marketsScored,
      errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      marketsProcessed: result.marketsProcessed,
      marketsScored: result.marketsScored,
      marketsSkipped: result.marketsSkipped,
      errors: result.errors,
      durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/market-opportunity] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
