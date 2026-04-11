import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  geographies,
  demandCapacityScores,
  permitData,
  employmentData,
  tradeCapacityData,
} from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { generateMarketNarrative } from "@/lib/narrative";

// In-memory cache (survives across requests in the same serverless instance)
const narrativeCache = new Map<string, { full: string; snippet: string; generatedAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Check cache
  const cached = narrativeCache.get(id);
  if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
    return NextResponse.json({ full: cached.full, snippet: cached.snippet, cached: true });
  }

  // Get market data
  const [market] = await db.select().from(geographies).where(eq(geographies.id, id)).limit(1);
  if (!market) return NextResponse.json({ error: "Market not found" }, { status: 404 });

  const [latestScore] = await db
    .select()
    .from(demandCapacityScores)
    .where(eq(demandCapacityScores.geographyId, id))
    .orderBy(desc(demandCapacityScores.scoreDate))
    .limit(1);

  const [latestPermit] = await db
    .select()
    .from(permitData)
    .where(eq(permitData.geographyId, id))
    .orderBy(desc(permitData.periodDate))
    .limit(1);

  const [latestEmp] = await db
    .select()
    .from(employmentData)
    .where(eq(employmentData.geographyId, id))
    .orderBy(desc(employmentData.periodDate))
    .limit(1);

  const [tradeCap] = await db
    .select({
      totalWorkers: sql<number>`SUM(avg_monthly_employment)`,
      avgWageYoy: sql<number>`ROUND(AVG(CAST(wage_yoy_change_pct AS numeric)), 1)`,
      totalEstabs: sql<number>`SUM(establishment_count)`,
    })
    .from(tradeCapacityData)
    .where(
      sql`${tradeCapacityData.geographyId} = ${id} AND ${tradeCapacityData.periodDate} = (
        SELECT MAX(period_date) FROM trade_capacity_data WHERE geography_id = ${id}
      )`
    );

  if (!latestScore) {
    return NextResponse.json({ full: "", snippet: "", error: "No scores available" });
  }

  const narrative = await generateMarketNarrative({
    name: market.shortName,
    state: market.state,
    demandIndex: parseFloat(String(latestScore.demandIndex)),
    capacityIndex: parseFloat(String(latestScore.capacityIndex)),
    ratio: parseFloat(String(latestScore.demandCapacityRatio)),
    status: latestScore.status,
    permits: latestPermit?.totalPermits ?? null,
    employment: latestEmp?.totalNonfarm ?? null,
    unemploymentRate: latestEmp?.unemploymentRate ? parseFloat(String(latestEmp.unemploymentRate)) : null,
    tradeWorkers: tradeCap ? Number(tradeCap.totalWorkers) : null,
    wageGrowthYoy: tradeCap ? Number(tradeCap.avgWageYoy) : null,
    establishments: tradeCap ? Number(tradeCap.totalEstabs) : null,
  });

  // Cache it
  narrativeCache.set(id, { ...narrative, generatedAt: Date.now() });

  return NextResponse.json({ full: narrative.full, snippet: narrative.snippet, cached: false });
}
