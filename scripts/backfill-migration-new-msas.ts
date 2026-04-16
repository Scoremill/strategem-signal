/**
 * Backfill migration_data for every market that doesn't already have rows.
 * Uses Census ACS 1-year table B01003 (total population) per vintage.
 * Net domestic migration isn't published directly by ACS at MSA level,
 * so we store total_population and leave net_domestic_migration null —
 * the scorer already falls back to populationChangePct when
 * netDomesticMigration is missing (Phase 2 Filter 1).
 *
 * 3 vintages = 3 annual rows per market = 441 rows total.
 */
import { db } from "../src/lib/db";
import { geographies, migrationData } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

interface AcsRow {
  cbsa: string;
  population: number;
}

async function fetchAcs(vintage: number): Promise<AcsRow[]> {
  const url = `https://api.census.gov/data/${vintage}/acs/acs1?get=NAME,B01003_001E&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:*`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ACS ${vintage} HTTP ${res.status}`);
  const rows: string[][] = await res.json();
  const out: AcsRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const [, valueStr, cbsa] = rows[i];
    const v = parseInt(valueStr, 10);
    if (Number.isFinite(v) && v > 0) out.push({ cbsa, population: v });
  }
  return out;
}

async function main() {
  const startedAt = Date.now();
  const markets = await db
    .select({
      id: geographies.id,
      cbsaFips: geographies.cbsaFips,
      shortName: geographies.shortName,
    })
    .from(geographies)
    .where(eq(geographies.isActive, true));

  const existingCounts = await db
    .select({
      geoId: migrationData.geographyId,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(migrationData)
    .groupBy(migrationData.geographyId);
  const countByGeo = new Map(existingCounts.map((r) => [r.geoId, Number(r.count)]));
  const toBackfill = markets.filter((m) => (countByGeo.get(m.id) ?? 0) < 2);
  console.log(`[backfill-migration] ${markets.length} markets, backfilling ${toBackfill.length}`);

  const vintages = [2021, 2022, 2023];
  const byVintage = new Map<number, Map<string, number>>();
  for (const v of vintages) {
    try {
      const data = await fetchAcs(v);
      byVintage.set(v, new Map(data.map((r) => [r.cbsa, r.population])));
      console.log(`  ACS ${v}: ${byVintage.get(v)!.size} MSAs`);
    } catch (e) {
      console.warn(`  ACS ${v}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let inserted = 0;
  let marketsWithData = 0;
  for (const m of toBackfill) {
    const sortedVintages = [...byVintage.keys()].sort((a, b) => a - b);
    let marketRows = 0;
    for (let i = 0; i < sortedVintages.length; i++) {
      const year = sortedVintages[i];
      const population = byVintage.get(year)!.get(m.cbsaFips);
      if (population == null) continue;
      let popChange: number | null = null;
      if (i > 0) {
        const prior = byVintage.get(sortedVintages[i - 1])?.get(m.cbsaFips);
        if (prior && prior > 0) popChange = ((population - prior) / prior) * 100;
      }
      await db
        .insert(migrationData)
        .values({
          id: randomUUID(),
          geographyId: m.id,
          year,
          netDomesticMigration: null,
          netInternationalMigration: null,
          totalPopulation: population,
          populationChangePct: popChange != null ? String(popChange.toFixed(2)) : null,
          source: "census_acs_backfill",
        })
        .onConflictDoNothing();
      marketRows++;
      inserted++;
    }
    if (marketRows > 0) marketsWithData++;
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n[backfill-migration] Done in ${elapsed}s`);
  console.log(`  Markets with data: ${marketsWithData}/${toBackfill.length}`);
  console.log(`  Rows inserted: ${inserted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
