/**
 * One-shot: refresh Q3 2025 trade capacity data for the 38 MSA-level markets
 * that are still stuck on Q2 2025 because yesterday's original backfill stopped
 * before BLS published Q3. After this runs all 52 markets should have Q3 2025
 * as their newest period.
 *
 * Run: node --env-file=.env.local --import tsx scripts/refresh-q3-2025.ts
 */
import { db } from "../src/lib/db";
import { geographies, tradeCapacityData } from "../src/lib/db/schema";
import { fetchQcewTrades } from "../src/lib/pipelines/qcew-client";
import { eq, and, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

const YEAR = 2025;
const QUARTER = 3;
const PERIOD_DATE = "2025-09-30";

async function main() {
  // Find every active market that does NOT have Q3 2025 data
  const allMarkets = await db.select().from(geographies).where(eq(geographies.isActive, true));

  const haveQ3 = await db
    .select({ geographyId: tradeCapacityData.geographyId })
    .from(tradeCapacityData)
    .where(eq(tradeCapacityData.periodDate, PERIOD_DATE))
    .groupBy(tradeCapacityData.geographyId);

  const haveSet = new Set(haveQ3.map((r) => r.geographyId));
  const missing = allMarkets.filter((m) => !haveSet.has(m.id));

  console.log(`${allMarkets.length} active markets, ${haveSet.size} already have Q3 2025, ${missing.length} need refresh\n`);

  let inserted = 0;
  const errors: string[] = [];

  for (const market of missing) {
    try {
      await new Promise((r) => setTimeout(r, 1000)); // BLS rate limit
      const trades = await fetchQcewTrades(market.cbsaFips, YEAR, QUARTER);

      if (trades.length === 0) {
        console.log(`  ⚠ ${market.shortName}: no Q3 2025 data available from BLS`);
        continue;
      }

      for (const trade of trades) {
        await db
          .insert(tradeCapacityData)
          .values({
            id: randomUUID(),
            geographyId: market.id,
            periodDate: PERIOD_DATE,
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
        inserted++;
      }

      const totalWorkers = trades.reduce((s, t) => s + t.avgMonthlyEmployment, 0);
      console.log(`  ✓ ${market.shortName}: ${trades.length} sectors, ${totalWorkers.toLocaleString()} workers`);
    } catch (err) {
      const msg = `${market.shortName}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`  ✗ ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`\nDone — ${inserted} records inserted, ${errors.length} errors`);
}

main().catch((e) => { console.error(e); process.exit(1); });
