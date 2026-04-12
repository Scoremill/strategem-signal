import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { geographies, demandCapacityScores, tradeCapacityData } from "@/lib/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { computeFeasibility, generateFeasibilityNarrative, FeasibilityInput } from "@/lib/feasibility";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const { geographyId, totalLots, startsPerMonth } = await request.json();

    if (!geographyId || !totalLots || !startsPerMonth) {
      return NextResponse.json({ error: "Missing required fields: geographyId, totalLots, startsPerMonth" }, { status: 400 });
    }

    // Fetch market data
    const [market] = await db.select().from(geographies).where(eq(geographies.id, geographyId)).limit(1);
    if (!market) return NextResponse.json({ error: "Market not found" }, { status: 404 });

    const [score] = await db
      .select()
      .from(demandCapacityScores)
      .where(eq(demandCapacityScores.geographyId, geographyId))
      .orderBy(desc(demandCapacityScores.scoreDate))
      .limit(1);

    if (!score) return NextResponse.json({ error: "Market not yet scored" }, { status: 404 });

    const [tradeCap] = await db
      .select({
        totalWorkers: sql<number>`SUM(avg_monthly_employment)`,
        avgWageYoy: sql<number>`ROUND(AVG(CAST(wage_yoy_change_pct AS numeric)), 1)`,
        totalEstabs: sql<number>`SUM(establishment_count)`,
      })
      .from(tradeCapacityData)
      .where(
        sql`${tradeCapacityData.geographyId} = ${geographyId} AND ${tradeCapacityData.periodDate} = (
          SELECT MAX(period_date) FROM trade_capacity_data WHERE geography_id = ${geographyId}
        )`
      );

    const input: FeasibilityInput = {
      marketName: market.shortName,
      marketState: market.state,
      totalLots: Number(totalLots),
      startsPerMonth: Number(startsPerMonth),
      estMonthlyStarts: score.estMonthlyStarts ?? 0,
      tradeWorkers: tradeCap ? Number(tradeCap.totalWorkers) : 0,
      tradeAvailability: parseFloat(String(score.tradeAvailability ?? 0)),
      wageGrowthYoy: tradeCap ? Number(tradeCap.avgWageYoy) : 0,
      demandCapacityRatio: parseFloat(String(score.demandCapacityRatio)),
      status: score.status,
      demandIndex: parseFloat(String(score.demandIndex)),
      capacityIndex: parseFloat(String(score.capacityIndex)),
      establishments: tradeCap ? Number(tradeCap.totalEstabs) : 0,
    };

    const metrics = computeFeasibility(input);
    const narrative = await generateFeasibilityNarrative(input, metrics);

    return NextResponse.json({
      input,
      ...metrics,
      ...narrative,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
