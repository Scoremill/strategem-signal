/**
 * Weekly Market Intelligence Digest builder.
 * Pulls the most recent scoring snapshot, computes week-over-week movement
 * from the prior snapshot, and renders an HTML email summarizing the
 * portfolio for executive subscribers.
 */
import { db } from "@/lib/db";
import { geographies, demandCapacityScores } from "@/lib/db/schema";
import { eq, sql, desc } from "drizzle-orm";

interface MarketSnapshot {
  id: string;
  shortName: string;
  state: string;
  demandIndex: number;
  capacityIndex: number;
  ratio: number;
  status: string;
}

interface MarketMover {
  market: MarketSnapshot;
  prior: number;
  change: number;
}

export interface DigestPayload {
  generatedAt: string;
  scoreDate: string;
  totals: { constrained: number; equilibrium: number; favorable: number };
  topConstrained: MarketSnapshot[];
  topFavorable: MarketSnapshot[];
  deteriorating: MarketMover[]; // ratio rising = capacity tightening
  improving: MarketMover[];     // ratio falling = capacity catching up
}

export async function buildDigestPayload(): Promise<DigestPayload> {
  // Most recent scoring date
  const [latest] = await db
    .select({ scoreDate: demandCapacityScores.scoreDate })
    .from(demandCapacityScores)
    .orderBy(desc(demandCapacityScores.scoreDate))
    .limit(1);

  if (!latest) throw new Error("No scoring data found");

  const scoreDate = String(latest.scoreDate);

  // Pull all current scores joined with geography info
  const currentRows = await db
    .select({
      id: geographies.id,
      shortName: geographies.shortName,
      state: geographies.state,
      demandIndex: demandCapacityScores.demandIndex,
      capacityIndex: demandCapacityScores.capacityIndex,
      ratio: demandCapacityScores.demandCapacityRatio,
      status: demandCapacityScores.status,
    })
    .from(demandCapacityScores)
    .innerJoin(geographies, eq(demandCapacityScores.geographyId, geographies.id))
    .where(eq(demandCapacityScores.scoreDate, scoreDate));

  const current: MarketSnapshot[] = currentRows.map((r) => ({
    id: r.id,
    shortName: r.shortName,
    state: r.state,
    demandIndex: parseFloat(String(r.demandIndex)),
    capacityIndex: parseFloat(String(r.capacityIndex)),
    ratio: parseFloat(String(r.ratio)),
    status: r.status,
  }));

  // Prior snapshot — second-most-recent score date
  const [prior] = await db
    .select({ scoreDate: demandCapacityScores.scoreDate })
    .from(demandCapacityScores)
    .where(sql`${demandCapacityScores.scoreDate} < ${scoreDate}`)
    .orderBy(desc(demandCapacityScores.scoreDate))
    .limit(1);

  const priorRatioMap = new Map<string, number>();
  if (prior) {
    const priorRows = await db
      .select({
        geographyId: demandCapacityScores.geographyId,
        ratio: demandCapacityScores.demandCapacityRatio,
      })
      .from(demandCapacityScores)
      .where(eq(demandCapacityScores.scoreDate, prior.scoreDate));
    for (const r of priorRows) {
      priorRatioMap.set(r.geographyId, parseFloat(String(r.ratio)));
    }
  }

  // Counts by status
  const totals = {
    constrained: current.filter((m) => m.status === "constrained").length,
    equilibrium: current.filter((m) => m.status === "equilibrium").length,
    favorable: current.filter((m) => m.status === "favorable").length,
  };

  // Top markets by status
  const topConstrained = [...current]
    .filter((m) => m.status === "constrained")
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5);

  const topFavorable = [...current]
    .filter((m) => m.status === "favorable")
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 5);

  // Movers: only computable if we have a prior snapshot
  const movers: MarketMover[] = current
    .map((m) => {
      const prior = priorRatioMap.get(m.id);
      if (prior == null) return null;
      return { market: m, prior, change: m.ratio - prior };
    })
    .filter((x): x is MarketMover => x !== null);

  const deteriorating = [...movers]
    .filter((m) => m.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, 5);

  const improving = [...movers]
    .filter((m) => m.change < 0)
    .sort((a, b) => a.change - b.change)
    .slice(0, 5);

  return {
    generatedAt: new Date().toISOString(),
    scoreDate,
    totals,
    topConstrained,
    topFavorable,
    deteriorating,
    improving,
  };
}

// ─── HTML rendering ──────────────────────────────────────────────

const COLORS = {
  orange: "#F97316",
  darkOrange: "#EA580C",
  navy: "#1E293B",
  gray600: "#4B5563",
  gray500: "#6B7280",
  gray100: "#F3F4F6",
  white: "#FFFFFF",
  red: "#DC2626",
  amber: "#D97706",
  green: "#059669",
};

function statusColor(status: string): string {
  if (status === "constrained") return COLORS.red;
  if (status === "equilibrium") return COLORS.amber;
  return COLORS.green;
}

function fmtRatio(r: number): string {
  return r.toFixed(2);
}

function moverRow(m: MarketMover, color: string): string {
  const sign = m.change >= 0 ? "+" : "";
  return `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;color:${COLORS.navy};font-size:13px;">
        ${m.market.shortName}, ${m.market.state}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;color:${COLORS.gray600};font-size:13px;">
        ${fmtRatio(m.prior)} → ${fmtRatio(m.market.ratio)}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;color:${color};font-size:13px;font-weight:600;">
        ${sign}${m.change.toFixed(3)}
      </td>
    </tr>
  `;
}

function marketRow(m: MarketSnapshot): string {
  return `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;color:${COLORS.navy};font-size:13px;">
        ${m.shortName}, ${m.state}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;color:${COLORS.gray600};font-size:13px;">
        D ${m.demandIndex.toFixed(0)} / C ${m.capacityIndex.toFixed(0)}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:right;font-size:13px;font-weight:600;color:${statusColor(m.status)};">
        ${fmtRatio(m.ratio)}
      </td>
    </tr>
  `;
}

export function renderDigestHtml(p: DigestPayload, appUrl: string): string {
  const dateStr = new Date(p.scoreDate).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const moversSection = p.deteriorating.length || p.improving.length
    ? `
      <h2 style="font-size:16px;color:${COLORS.darkOrange};margin:32px 0 12px;font-family:Calibri,Arial,sans-serif;">Week-over-Week Movement</h2>

      ${p.deteriorating.length ? `
        <p style="font-size:13px;color:${COLORS.gray600};margin:4px 0 8px;font-family:Calibri,Arial,sans-serif;">
          <strong>Deteriorating</strong> — ratio rising means demand is outrunning capacity.
        </p>
        <table cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:${COLORS.white};border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin-bottom:16px;">
          ${p.deteriorating.map((m) => moverRow(m, COLORS.red)).join("")}
        </table>
      ` : ""}

      ${p.improving.length ? `
        <p style="font-size:13px;color:${COLORS.gray600};margin:4px 0 8px;font-family:Calibri,Arial,sans-serif;">
          <strong>Improving</strong> — ratio falling means capacity is catching up.
        </p>
        <table cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:${COLORS.white};border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
          ${p.improving.map((m) => moverRow(m, COLORS.green)).join("")}
        </table>
      ` : ""}
    `
    : `
      <p style="font-size:13px;color:${COLORS.gray500};margin:24px 0 0;font-family:Calibri,Arial,sans-serif;font-style:italic;">
        Movement comparison will appear once a second scoring snapshot is available.
      </p>
    `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>StrategemSignal — Weekly Market Intelligence Digest</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:Calibri,Arial,sans-serif;line-height:1.5;">
  <div style="max-width:640px;margin:0 auto;padding:32px 24px;">

    <div style="border-bottom:3px solid ${COLORS.orange};padding-bottom:16px;margin-bottom:24px;">
      <h1 style="margin:0;font-size:24px;color:${COLORS.orange};font-weight:700;">StrategemSignal</h1>
      <p style="margin:4px 0 0;font-size:13px;color:${COLORS.gray500};">Weekly Market Intelligence Digest · ${dateStr}</p>
    </div>

    <p style="font-size:14px;color:${COLORS.navy};margin:0 0 24px;">
      The portfolio currently spans <strong>${p.totals.constrained + p.totals.equilibrium + p.totals.favorable}</strong> monitored MSAs.
      <span style="color:${COLORS.red};font-weight:600;">${p.totals.constrained} constrained</span>,
      <span style="color:${COLORS.amber};font-weight:600;">${p.totals.equilibrium} balanced</span>, and
      <span style="color:${COLORS.green};font-weight:600;">${p.totals.favorable} favorable</span> based on the latest demand-capacity ratios.
    </p>

    ${p.topConstrained.length ? `
      <h2 style="font-size:16px;color:${COLORS.darkOrange};margin:24px 0 12px;">Most Constrained Markets</h2>
      <p style="font-size:13px;color:${COLORS.gray600};margin:0 0 8px;">
        Demand is outpacing trade capacity. Cycle time and margin are at risk; lock trade contracts now.
      </p>
      <table cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:${COLORS.white};border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
        ${p.topConstrained.map(marketRow).join("")}
      </table>
    ` : ""}

    ${p.topFavorable.length ? `
      <h2 style="font-size:16px;color:${COLORS.darkOrange};margin:32px 0 12px;">Most Favorable Markets</h2>
      <p style="font-size:13px;color:${COLORS.gray600};margin:0 0 8px;">
        Capacity is comfortably ahead of demand. Best conditions for negotiating fixed-price bids and underwriting new communities.
      </p>
      <table cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:${COLORS.white};border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
        ${p.topFavorable.map(marketRow).join("")}
      </table>
    ` : ""}

    ${moversSection}

    <div style="margin-top:40px;padding-top:16px;border-top:1px solid #E5E7EB;text-align:center;">
      <a href="${appUrl}/heatmap" style="display:inline-block;background:${COLORS.orange};color:${COLORS.white};text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">
        Open the Heatmap →
      </a>
      <p style="font-size:11px;color:${COLORS.gray500};margin:24px 0 0;">
        Strategem · Build Faster. Spend Smarter. Deliver More.<br>
        Generated ${new Date(p.generatedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT
      </p>
    </div>
  </div>
</body>
</html>`;
}
