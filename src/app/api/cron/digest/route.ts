import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchLogs } from "@/lib/db/schema";
import { buildDigestPayload, renderDigestHtml } from "@/lib/digest";
import { sendMail, getDigestRecipients } from "@/lib/mailer";
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

  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get("dryRun") === "true";
  const overrideTo = searchParams.get("to");

  const startTime = Date.now();

  try {
    const payload = await buildDigestPayload();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://strategem-signal.vercel.app";
    const html = renderDigestHtml(payload, appUrl);

    const recipients = overrideTo ? [overrideTo] : getDigestRecipients();
    if (!recipients.length) {
      return NextResponse.json(
        { error: "No digest recipients configured. Set DIGEST_RECIPIENTS or GMAIL_USER." },
        { status: 500 }
      );
    }

    const dateLabel = new Date(payload.scoreDate).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const subject = `StrategemSignal Weekly Digest — ${dateLabel} (${payload.totals.constrained} constrained, ${payload.totals.favorable} favorable)`;

    let messageId: string | null = null;
    if (!dryRun) {
      const sent = await sendMail({ to: recipients, subject, html });
      messageId = sent.messageId;
    }

    const durationMs = Date.now() - startTime;

    await db.insert(fetchLogs).values({
      id: randomUUID(),
      pipeline: "digest",
      recordsFetched: recipients.length,
      recordsNew: dryRun ? 0 : recipients.length,
      errors: null,
      durationMs,
    });

    return NextResponse.json({
      ok: true,
      dryRun,
      recipients,
      subject,
      messageId,
      payload: {
        scoreDate: payload.scoreDate,
        totals: payload.totals,
        topConstrained: payload.topConstrained.length,
        topFavorable: payload.topFavorable.length,
        deteriorating: payload.deteriorating.length,
        improving: payload.improving.length,
      },
      durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/digest] error:", msg);

    await db.insert(fetchLogs).values({
      id: randomUUID(),
      pipeline: "digest",
      recordsFetched: 0,
      recordsNew: 0,
      errors: JSON.stringify([msg]),
      durationMs: Date.now() - startTime,
    });

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
