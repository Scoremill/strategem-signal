import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  geographies,
  zillowZhvi,
  fhfaHpi,
  portfolioHealthSnapshots,
  marketOpportunityScores,
} from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import RetrospectiveClient, {
  type RetroMarket,
} from "./RetrospectiveClient";

export const dynamic = "force-dynamic";

const RETRO_MARKET_IDS = [
  "bf1c148a-d548-4015-a537-7df6de9d6ad3", // Greenville-Anderson, SC
  "438fc4d5-8e50-40c5-a171-3b10bd4c4a73", // Nashville, TN
  "3a1b5917-de77-4e71-92c9-e4d08f56c15e", // Fayetteville-Springdale, AR
];

export default async function RetrospectivePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const markets: RetroMarket[] = [];

  for (const geoId of RETRO_MARKET_IDS) {
    const [geo] = await db
      .select()
      .from(geographies)
      .where(eq(geographies.id, geoId))
      .limit(1);
    if (!geo) continue;

    const zhviRows = await db
      .select({
        periodDate: zillowZhvi.periodDate,
        medianHomeValue: zillowZhvi.medianHomeValue,
      })
      .from(zillowZhvi)
      .where(eq(zillowZhvi.geographyId, geoId))
      .orderBy(zillowZhvi.periodDate);

    const hpiRows = await db
      .select({
        year: fhfaHpi.year,
        quarter: fhfaHpi.quarter,
        hpi: fhfaHpi.hpi,
        hpiYoyChangePct: fhfaHpi.hpiYoyChangePct,
      })
      .from(fhfaHpi)
      .where(eq(fhfaHpi.geographyId, geoId))
      .orderBy(fhfaHpi.year, fhfaHpi.quarter);

    const [healthRow] = await db
      .select()
      .from(portfolioHealthSnapshots)
      .where(
        and(
          eq(portfolioHealthSnapshots.geographyId, geoId),
          sql`${portfolioHealthSnapshots.snapshotDate} = (
            SELECT MAX(${portfolioHealthSnapshots.snapshotDate})
            FROM ${portfolioHealthSnapshots}
            WHERE ${portfolioHealthSnapshots.geographyId} = ${geoId}
          )`
        )
      )
      .limit(1);

    const [oppRow] = await db
      .select()
      .from(marketOpportunityScores)
      .where(
        and(
          eq(marketOpportunityScores.geographyId, geoId),
          sql`${marketOpportunityScores.snapshotDate} = (
            SELECT MAX(${marketOpportunityScores.snapshotDate})
            FROM ${marketOpportunityScores}
            WHERE ${marketOpportunityScores.geographyId} = ${geoId}
          )`
        )
      )
      .limit(1);

    markets.push({
      id: geo.id,
      name: geo.name,
      shortName: geo.shortName,
      state: geo.state,
      population: geo.population,
      zhvi: zhviRows.map((r) => ({
        date: r.periodDate,
        value: r.medianHomeValue,
      })),
      hpi: hpiRows.map((r) => ({
        label: `${r.year} Q${r.quarter}`,
        hpi: r.hpi ? parseFloat(String(r.hpi)) : null,
        yoy: r.hpiYoyChangePct ? parseFloat(String(r.hpiYoyChangePct)) : null,
      })),
      health: healthRow
        ? {
            composite: parseFloat(String(healthRow.compositeScore ?? "0")),
            financial: parseFloat(String(healthRow.financialScore ?? "0")),
            demand: parseFloat(String(healthRow.demandScore ?? "0")),
            operational: parseFloat(String(healthRow.operationalScore ?? "0")),
            snapshotDate: healthRow.snapshotDate,
          }
        : null,
      opportunity: oppRow
        ? {
            filter1: parseFloat(String(oppRow.filter1Migration ?? "0")),
            filter2: parseFloat(String(oppRow.filter2Diversity ?? "0")),
            filter3: parseFloat(String(oppRow.filter3Imbalance ?? "0")),
            filter4: oppRow.filter4Competitive
              ? parseFloat(String(oppRow.filter4Competitive))
              : null,
            filter5: oppRow.filter5Affordability
              ? parseFloat(String(oppRow.filter5Affordability))
              : null,
            filter6: parseFloat(String(oppRow.filter6Operational ?? "0")),
            numGreen: oppRow.numGreen ?? 0,
          }
        : null,
    });
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-[#1E293B]">
          Retrospective Analysis
        </h1>
        <p className="text-xs text-[#6B7280] mt-0.5">
          How StrategemSignal would have flagged these markets 6-12 months
          before consensus
        </p>
      </header>
      <main className="flex-1 overflow-y-auto">
        <RetrospectiveClient markets={markets} />
      </main>
    </div>
  );
}
