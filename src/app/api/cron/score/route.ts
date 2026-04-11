import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchLogs } from "@/lib/db/schema";
import { runScoringEngine } from "@/lib/scoring/engine";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    const result = await runScoringEngine();
    const durationMs = Date.now() - startTime;

    await db.insert(fetchLogs).values({
      id: randomUUID(),
      pipeline: "scoring",
      recordsFetched: result.marketsScored,
      recordsNew: result.marketsScored,
      errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      marketsScored: result.marketsScored,
      scores: result.scores,
      durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/score] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
