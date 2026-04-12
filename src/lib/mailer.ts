/**
 * Gmail/Nodemailer transport for outbound StrategemSignal email.
 * Uses an App Password (not OAuth) — same pattern as other Strategem projects.
 */
import nodemailer, { type Transporter } from "nodemailer";

let cached: Transporter | null = null;

function getTransport(): Transporter {
  if (cached) return cached;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD must be set");
  }

  cached = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  return cached;
}

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export async function sendMail(args: SendArgs): Promise<{ messageId: string }> {
  const transport = getTransport();
  const from = `StrategemSignal <${process.env.GMAIL_USER}>`;
  const info = await transport.sendMail({
    from,
    to: Array.isArray(args.to) ? args.to.join(", ") : args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
  });
  return { messageId: info.messageId };
}

/**
 * Resolve digest recipients. Falls back to GMAIL_USER if DIGEST_RECIPIENTS unset,
 * so a misconfigured production deploy still emails the operator instead of silently failing.
 */
export function getDigestRecipients(): string[] {
  const list = process.env.DIGEST_RECIPIENTS;
  if (list) {
    return list.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const fallback = process.env.GMAIL_USER;
  return fallback ? [fallback] : [];
}
