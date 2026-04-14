/**
 * Backfill trade_capacity_data 2023Q1-2025Q2 for every market that
 * doesn't already have QCEW rows. Reuses fetchQcewTrades from
 * qcew-client.ts which handles NAICS 238x (construction specialty trades).
 */
import { db } from "../src/lib/db";
import { geographies, tradeCapacityData } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { fetchQcewTrades } from "../src/lib/pipelines/qcew-client";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function quarterEndDate(year: number, quarter: number): string {
  const month = quarter * 3;
  const d = new Date(year, month, 0);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const startedAt = Date.now();
  const markets = await db
    .select({
      id: geographies.id,
      cbsaFips: geographies.cbsaFips,
      shortName: geographies.shortName,
      state: geographies.state,
    })
    .from(geographies)
    .where(eq(geographies.isActive, true));

  const existingCounts = await db
    .select({
      geoId: tradeCapacityData.geographyId,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(tradeCapacityData)
    .groupBy(tradeCapacityData.geographyId);
  const countByGeo = new Map(existingCounts.map((r) => [r.geoId, Number(r.count)]));
  const toBackfill = markets.filter((m) => (countByGeo.get(m.id) ?? 0) < 4);
  console.log(`[backfill-qcew] ${markets.length} markets, backfilling ${toBackfill.length}`);

  const quarters: Array<{ year: number; quarter: number }> = [];
  for (let y = 2023; y <= 2025; y++) {
    for (let q = 1; q <= 4; q++) {
      if (y === 2025 && q > 2) break;
      quarters.push({ year: y, quarter: q });
    }
  }
  console.log(`  Quarters: ${quarters.length} (${quarters[0].year}Q${quarters[0].quarter} → ${quarters[quarters.length - 1].year}Q${quarters[quarters.length - 1].quarter})`);

  let inserted = 0;
  let marketsWithData = 0;
  let marketsScanned = 0;
  const errors: string[] = [];

  for (const m of toBackfill) {
    marketsScanned++;
    let marketRows = 0;
    for (const { year, quarter } of quarters) {
      try {
        const records = await fetchQcewTrades(m.cbsaFips, year, quarter);
        if (records.length === 0) {
          await sleep(600);
          continue;
        }
        const periodDate = quarterEndDate(year, quarter);
        for (const r of records) {
          await db
            .insert(tradeCapacityData)
            .values({
              id: randomUUID(),
              geographyId: m.id,
              periodDate,
              naicsCode: r.naicsCode,
              naicsDescription: r.naicsDescription,
              avgMonthlyEmployment: r.avgMonthlyEmployment,
              totalQuarterlyWages: r.totalQuarterlyWages,
              avgWeeklyWage: String(r.avgWeeklyWage),
              establishmentCount: r.establishmentCount,
              wageYoyChangePct:
                r.wageYoyChangePct != null ? String(r.wageYoyChangePct) : null,
              employmentYoyChangePct:
                r.employmentYoyChangePct != null
                  ? String(r.employmentYoyChangePct)
                  : null,
              source: "bls_qcew_backfill",
            })
            .onConflictDoNothing();
          marketRows++;
          inserted++;
        }
      } catch (e) {
        errors.push(
          `${m.shortName} ${year}Q${quarter}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      await sleep(600);
    }
    if (marketRows > 0) marketsWithData++;
    if (marketsScanned % 10 === 0) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(
        `  ${marketsScanned}/${toBackfill.length} markets scanned, ${marketsWithData} with data, ${inserted} rows, elapsed ${elapsed}s`
      );
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n[backfill-qcew] Done in ${elapsed}s`);
  console.log(`  Markets with data: ${marketsWithData}/${toBackfill.length}`);
  console.log(`  Rows inserted: ${inserted}`);
  console.log(`  Errors: ${errors.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
