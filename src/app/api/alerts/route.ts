import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { geographies, tradeCapacityData, demandCapacityScores } from "@/lib/db/schema";
import { eq, sql, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface Alert {
  market: string;
  state: string;
  type: "wage_acceleration" | "capacity_constrained" | "ratio_deteriorating";
  severity: "warning" | "critical";
  message: string;
  value: number;
}

export async function GET() {
  const alerts: Alert[] = [];

  const markets = await db.select().from(geographies).where(eq(geographies.isActive, true));

  for (const market of markets) {
    // Check wage acceleration > 5% YoY
    const trades = await db
      .select()
      .from(tradeCapacityData)
      .where(
        sql`${tradeCapacityData.geographyId} = ${market.id} AND ${tradeCapacityData.periodDate} = (
          SELECT MAX(period_date) FROM trade_capacity_data WHERE geography_id = ${market.id}
        )`
      );

    for (const trade of trades) {
      const wageYoy = Number(trade.wageYoyChangePct);
      if (wageYoy > 7) {
        alerts.push({
          market: market.shortName,
          state: market.state,
          type: "wage_acceleration",
          severity: "critical",
          message: `${trade.naicsDescription} wages up ${wageYoy}% YoY — severe capacity pressure`,
          value: wageYoy,
        });
      } else if (wageYoy > 5) {
        alerts.push({
          market: market.shortName,
          state: market.state,
          type: "wage_acceleration",
          severity: "warning",
          message: `${trade.naicsDescription} wages up ${wageYoy}% YoY — trade cost escalation`,
          value: wageYoy,
        });
      }
    }

    // Check D/C ratio > 1.5 (severely constrained)
    const [score] = await db
      .select()
      .from(demandCapacityScores)
      .where(eq(demandCapacityScores.geographyId, market.id))
      .orderBy(desc(demandCapacityScores.scoreDate))
      .limit(1);

    if (score) {
      const ratio = parseFloat(String(score.demandCapacityRatio));
      if (ratio > 1.5) {
        alerts.push({
          market: market.shortName,
          state: market.state,
          type: "capacity_constrained",
          severity: "critical",
          message: `D/C Ratio at ${ratio.toFixed(2)} — demand significantly exceeds trade capacity`,
          value: ratio,
        });
      }
    }
  }

  // Sort by severity (critical first) then by value (highest first)
  alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return b.value - a.value;
  });

  return NextResponse.json({ alerts, count: alerts.length });
}
