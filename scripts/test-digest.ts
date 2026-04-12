/**
 * End-to-end test of the digest pipeline.
 * Renders the HTML to /tmp/digest-preview.html and sends a real email
 * if you pass --send. Otherwise dry-run only.
 *
 * Run: node --env-file=.env.local --import tsx scripts/test-digest.ts [--send]
 */
import { writeFileSync } from "fs";
import { buildDigestPayload, renderDigestHtml } from "../src/lib/digest";
import { sendMail, getDigestRecipients } from "../src/lib/mailer";

async function main() {
  const send = process.argv.includes("--send");

  console.log("Building digest payload...");
  const payload = await buildDigestPayload();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://strategem-signal.vercel.app";
  const html = renderDigestHtml(payload, appUrl);

  const previewPath = "/tmp/digest-preview.html";
  writeFileSync(previewPath, html);
  console.log(`Preview written to ${previewPath}`);

  console.log("\nDigest summary:");
  console.log(`  Score date: ${payload.scoreDate}`);
  console.log(`  Constrained: ${payload.totals.constrained}`);
  console.log(`  Equilibrium: ${payload.totals.equilibrium}`);
  console.log(`  Favorable:   ${payload.totals.favorable}`);
  console.log(`  Top constrained: ${payload.topConstrained.map((m) => m.shortName).join(", ")}`);
  console.log(`  Top favorable:   ${payload.topFavorable.map((m) => m.shortName).join(", ")}`);
  console.log(`  Deteriorating:   ${payload.deteriorating.length}`);
  console.log(`  Improving:       ${payload.improving.length}`);

  if (send) {
    const recipients = getDigestRecipients();
    console.log(`\nSending to: ${recipients.join(", ")}`);
    const subject = `[TEST] StrategemSignal Weekly Digest — ${new Date(payload.scoreDate).toLocaleDateString()}`;
    const sent = await sendMail({ to: recipients, subject, html });
    console.log(`Sent: ${sent.messageId}`);
  } else {
    console.log("\nDry run only. Pass --send to actually email.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
