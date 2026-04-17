/**
 * Capacity data pipeline — fetches trade employment, wages, and establishment
 * counts from BLS QCEW for all active MSAs.
 */
import { db } from "@/lib/db";
import { geographies, tradeCapacityData, permitData } from "@/lib/db/schema";
import { fetchQcewTrades, getLatestQcewQuarter, getBackfillQuarters } from "./qcew-client";
import { eq, sql, and, desc, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

interface CapacityPipelineResult {
  recordsInserted: number;
  quartersProcessed: number;
  errors: string[];
}

/**
 * Convert quarter to a period-end date string (e.g., Q2 2025 → "2025-06-30").
 */
function quarterEndDate(year: number, quarter: number): string {
  const month = quarter * 3;
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
}

/**
 * Run the capacity pipeline scoped to a specific list of CBSA FIPS codes.
 * Used for targeted backfills (e.g., new market additions) without re-running all 50+.
 */
export async function runCapacityPipelineForCbsas(
  cbsaFipsList: string[],
  backfill = false
): Promise<CapacityPipelineResult> {
  return runCapacityPipelineInternal(backfill, cbsaFipsList);
}

/**
 * Run the capacity pipeline for all active MSAs.
 */
export async function runCapacityPipeline(backfill = false): Promise<CapacityPipelineResult> {
  return runCapacityPipelineInternal(backfill);
}

async function runCapacityPipelineInternal(
  backfill: boolean,
  cbsaFilter?: string[]
): Promise<CapacityPipelineResult> {
  const markets = cbsaFilter && cbsaFilter.length
    ? await db.select().from(geographies).where(and(eq(geographies.isActive, true), inArray(geographies.cbsaFips, cbsaFilter)))
    : await db.select().from(geographies).where(eq(geographies.isActive, true));

  const quarters = backfill ? getBackfillQuarters() : [getLatestQcewQuarter()];

  const result: CapacityPipelineResult = {
    recordsInserted: 0,
    quartersProcessed: 0,
    errors: [],
  };

  console.log(
    `[capacity-pipeline] Starting for ${markets.length} markets, ${quarters.length} quarters, backfill=${backfill}`
  );

  for (const { year, quarter } of quarters) {
    const periodDate = quarterEndDate(year, quarter);
    console.log(`[capacity-pipeline] Processing ${year} Q${quarter} (${periodDate})...`);

    for (const market of markets) {
      try {
        // 1-second delay between API calls to be polite to BLS
        await new Promise((r) => setTimeout(r, 1000));

        const trades = await fetchQcewTrades(market.cbsaFips, year, quarter, market.state);

        for (const trade of trades) {
          await db
            .insert(tradeCapacityData)
            .values({
              id: randomUUID(),
              geographyId: market.id,
              periodDate,
              naicsCode: trade.naicsCode,
              naicsDescription: trade.naicsDescription,
              avgMonthlyEmployment: trade.avgMonthlyEmployment,
              totalQuarterlyWages: trade.totalQuarterlyWages,
              avgWeeklyWage: String(trade.avgWeeklyWage),
              establishmentCount: trade.establishmentCount,
              wageYoyChangePct: trade.wageYoyChangePct !== null ? String(trade.wageYoyChangePct) : null,
              employmentYoyChangePct: trade.employmentYoyChangePct !== null ? String(trade.employmentYoyChangePct) : null,
              source: "bls_qcew",
            })
            .onConflictDoNothing();
          result.recordsInserted++;
        }

        if (trades.length > 0) {
          console.log(
            `  ${market.shortName}: ${trades.length} trade sectors, ${trades.reduce((s, t) => s + t.avgMonthlyEmployment, 0).toLocaleString()} workers`
          );
        }
      } catch (err) {
        const msg = `${market.shortName}/${year}Q${quarter}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`  ERROR: ${msg}`);
        result.errors.push(msg);
      }
    }

    result.quartersProcessed++;
  }

  // Compute derived metrics after all data is loaded
  try {
    await computePermitsPerWorker(markets);
  } catch (err) {
    result.errors.push(`permits-per-worker: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(
    `[capacity-pipeline] Done: ${result.recordsInserted} records, ${result.quartersProcessed} quarters, ${result.errors.length} errors`
  );

  return result;
}

/**
 * Compute permits-per-worker ratio for each MSA.
 * This is a key derived metric: monthly permits / total trade workers.
 * Higher ratio = more demand pressure on available labor.
 */
async function computePermitsPerWorker(
  markets: Array<{ id: string; shortName: string; cbsaFips: string }>
) {
  console.log("[capacity-pipeline] Computing permits-per-worker ratios...");

  for (const market of markets) {
    // Get latest quarterly trade employment (sum across all NAICS 238x)
    const tradeEmp = await db
      .select({
        totalEmployment: sql<number>`SUM(avg_monthly_employment)`,
        periodDate: tradeCapacityData.periodDate,
      })
      .from(tradeCapacityData)
      .where(eq(tradeCapacityData.geographyId, market.id))
      .groupBy(tradeCapacityData.periodDate)
      .orderBy(desc(tradeCapacityData.periodDate))
      .limit(1);

    if (!tradeEmp.length || !tradeEmp[0].totalEmployment) continue;

    // Get latest monthly permits
    const [latestPermit] = await db
      .select({ totalPermits: permitData.totalPermits })
      .from(permitData)
      .where(eq(permitData.geographyId, market.id))
      .orderBy(desc(permitData.periodDate))
      .limit(1);

    if (!latestPermit) continue;

    const ratio = latestPermit.totalPermits / Number(tradeEmp[0].totalEmployment);
    console.log(
      `  ${market.shortName}: ${latestPermit.totalPermits} permits / ${Number(tradeEmp[0].totalEmployment).toLocaleString()} workers = ${ratio.toFixed(4)}`
    );
  }
}
