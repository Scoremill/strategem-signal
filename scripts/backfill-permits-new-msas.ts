/**
 * Backfill permit_data 2023-2025 for every geographies row that doesn't
 * already have permit rows. One-off for Phase 2.1; after this runs,
 * the monthly demand-data cron takes over going forward.
 */
import { db } from "../src/lib/db";
import { geographies, permitData } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { searchSeries, fetchSeries } from "../src/lib/pipelines/fred-client";

interface BackfillResult {
  marketsProcessed: number;
  marketsSkipped: number;
  marketsWithData: number;
  rowsInserted: number;
  errors: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function findPermitSeries(
  shortName: string,
  state: string,
  singleFamily: boolean
): Promise<string | null> {
  const query = `${shortName} ${state} building permits ${singleFamily ? "1-unit" : ""}`.trim();
  const results = await searchSeries(query, 10);
  for (const s of results) {
    const title = s.title || "";
    const id = s.id || "";
    if (!title.includes(shortName.split("-")[0])) continue;
    if (!title.includes(state)) continue;
    if (singleFamily) {
      if (!id.endsWith("BP1FHSA") && !id.endsWith("BP1FH")) continue;
      if (!title.includes("1-Unit")) continue;
    } else {
      if (!id.endsWith("BPPRIVSA") && !id.endsWith("BPPRIV")) continue;
    }
    return id;
  }
  return null;
}

async function main() {
  const startedAt = Date.now();
  const result: BackfillResult = {
    marketsProcessed: 0,
    marketsSkipped: 0,
    marketsWithData: 0,
    rowsInserted: 0,
    errors: [],
  };

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
      geoId: permitData.geographyId,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(permitData)
    .groupBy(permitData.geographyId);
  const countByGeo = new Map(existingCounts.map((r) => [r.geoId, Number(r.count)]));

  const toBackfill = markets.filter((m) => (countByGeo.get(m.id) ?? 0) < 5);
  console.log(
    `[backfill-permits] ${markets.length} active markets, backfilling ${toBackfill.length}`
  );

  const startDate = "2023-01-01";

  for (const m of toBackfill) {
    result.marketsProcessed++;
    try {
      await sleep(200);
      const totalSeriesId = await findPermitSeries(m.shortName, m.state, false);
      await sleep(200);
      const sfSeriesId = await findPermitSeries(m.shortName, m.state, true);

      if (!totalSeriesId && !sfSeriesId) {
        result.marketsSkipped++;
        console.warn(`  ✗ ${m.shortName}, ${m.state}: no FRED permit series found`);
        continue;
      }

      const [totalObs, sfObs] = await Promise.all([
        totalSeriesId ? fetchSeries(totalSeriesId, { startDate }) : Promise.resolve([]),
        sfSeriesId ? fetchSeries(sfSeriesId, { startDate }) : Promise.resolve([]),
      ]);

      const sfMap = new Map(
        sfObs.map((o) => [o.date, Math.round(parseFloat(o.value))])
      );

      let marketRows = 0;
      for (const obs of totalObs) {
        const total = Math.round(parseFloat(obs.value));
        if (!Number.isFinite(total)) continue;
        const sf = sfMap.get(obs.date) ?? null;
        const mf = sf !== null ? total - sf : null;
        await db
          .insert(permitData)
          .values({
            id: randomUUID(),
            geographyId: m.id,
            periodDate: obs.date,
            totalPermits: total,
            singleFamily: sf,
            multiFamily: mf,
            source: "fred_backfill",
          })
          .onConflictDoNothing();
        marketRows++;
      }
      if (totalObs.length === 0 && sfObs.length > 0) {
        for (const obs of sfObs) {
          const sf = Math.round(parseFloat(obs.value));
          if (!Number.isFinite(sf)) continue;
          await db
            .insert(permitData)
            .values({
              id: randomUUID(),
              geographyId: m.id,
              periodDate: obs.date,
              totalPermits: sf,
              singleFamily: sf,
              multiFamily: null,
              source: "fred_backfill_sf_only",
            })
            .onConflictDoNothing();
          marketRows++;
        }
      }

      if (marketRows > 0) {
        result.marketsWithData++;
        result.rowsInserted += marketRows;
        if (result.marketsWithData % 10 === 0) {
          console.log(
            `  ${result.marketsWithData} markets done, ${result.rowsInserted} rows, elapsed ${((Date.now() - startedAt) / 1000).toFixed(0)}s`
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${m.shortName}/${m.state}: ${msg}`);
      console.warn(`  ✗ ${m.shortName}, ${m.state}: ${msg}`);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n[backfill-permits] Done in ${elapsed}s`);
  console.log(`  Markets processed: ${result.marketsProcessed}`);
  console.log(`  Markets with data: ${result.marketsWithData}`);
  console.log(`  Markets skipped (no FRED series): ${result.marketsSkipped}`);
  console.log(`  Rows inserted: ${result.rowsInserted}`);
  console.log(`  Errors: ${result.errors.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
