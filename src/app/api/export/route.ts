import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  geographies,
  demandCapacityScores,
  permitData,
  employmentData,
  tradeCapacityData,
} from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const markets = await db.select().from(geographies).orderBy(geographies.shortName);

  // Get latest scores
  const latestScoreDate = await db
    .select({ maxDate: sql<string>`MAX(score_date)` })
    .from(demandCapacityScores);
  const scores = latestScoreDate[0]?.maxDate
    ? await db.select().from(demandCapacityScores).where(eq(demandCapacityScores.scoreDate, latestScoreDate[0].maxDate))
    : [];

  // Get latest permits
  const permits = await db
    .select({
      geographyId: permitData.geographyId,
      totalPermits: permitData.totalPermits,
      singleFamily: permitData.singleFamily,
    })
    .from(permitData)
    .where(
      sql`(${permitData.geographyId}, ${permitData.periodDate}) IN (
        SELECT geography_id, MAX(period_date) FROM permit_data GROUP BY geography_id
      )`
    );

  // Get latest employment
  const employment = await db
    .select({
      geographyId: employmentData.geographyId,
      totalNonfarm: employmentData.totalNonfarm,
      unemploymentRate: employmentData.unemploymentRate,
    })
    .from(employmentData)
    .where(
      sql`(${employmentData.geographyId}, ${employmentData.periodDate}) IN (
        SELECT geography_id, MAX(period_date) FROM employment_data GROUP BY geography_id
      )`
    );

  // Get latest trade capacity
  const tradeCap = await db
    .select({
      geographyId: tradeCapacityData.geographyId,
      totalWorkers: sql<number>`SUM(avg_monthly_employment)`,
      avgWage: sql<number>`ROUND(AVG(CAST(avg_weekly_wage AS numeric)))`,
      avgWageYoy: sql<number>`ROUND(AVG(CAST(wage_yoy_change_pct AS numeric)), 1)`,
      totalEstabs: sql<number>`SUM(establishment_count)`,
    })
    .from(tradeCapacityData)
    .where(
      sql`(${tradeCapacityData.geographyId}, ${tradeCapacityData.periodDate}) IN (SELECT geography_id, MAX(period_date) FROM trade_capacity_data GROUP BY geography_id)`
    )
    .groupBy(tradeCapacityData.geographyId);

  const scoreMap = new Map(scores.map((s) => [s.geographyId, s]));
  const permitMap = new Map(permits.map((p) => [p.geographyId, p]));
  const empMap = new Map(employment.map((e) => [e.geographyId, e]));
  const tradeMap = new Map(tradeCap.map((t) => [t.geographyId, t]));

  // Build CSV
  const headers = [
    "Market",
    "State",
    "CBSA FIPS",
    "Population",
    "Demand Index",
    "Capacity Index",
    "D/C Ratio",
    "Status",
    "Monthly Permits",
    "Single Family Permits",
    "Nonfarm Employment",
    "Unemployment Rate",
    "Trade Workers",
    "Avg Weekly Wage",
    "Wage Growth YoY",
    "Trade Contractors",
  ];

  const rows = markets.map((m) => {
    const s = scoreMap.get(m.id);
    const p = permitMap.get(m.id);
    const e = empMap.get(m.id);
    const t = tradeMap.get(m.id);
    const status = s?.status === "equilibrium" ? "Balanced" : s?.status === "constrained" ? "Constrained" : s?.status === "favorable" ? "Favorable" : "";

    return [
      m.shortName,
      m.state,
      m.cbsaFips,
      m.population ? `${(m.population / 1_000_000).toFixed(1)}M` : "",
      s ? parseFloat(String(s.demandIndex)).toFixed(0) : "",
      s ? parseFloat(String(s.capacityIndex)).toFixed(0) : "",
      s ? parseFloat(String(s.demandCapacityRatio)).toFixed(2) : "",
      status,
      p?.totalPermits ?? "",
      p?.singleFamily ?? "",
      e?.totalNonfarm ?? "",
      e?.unemploymentRate ?? "",
      t ? Number(t.totalWorkers) : "",
      t ? Number(t.avgWage) : "",
      t ? Number(t.avgWageYoy) : "",
      t ? Number(t.totalEstabs) : "",
    ].join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="strategem-signal-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
