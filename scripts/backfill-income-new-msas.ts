/**
 * Backfill income_data 2021-2023 vintages for every market that doesn't
 * already have income rows. Uses Census ACS 1-year table B19013
 * (median household income) which covers all ~384 MSAs natively in one
 * API call per vintage.
 */
import { db } from "../src/lib/db";
import { geographies, incomeData } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

const CENSUS_CBSA_OVERRIDE: Record<string, string> = {
  "17460": "17410", // Cleveland-Elyria, OH
};

interface AcsRow {
  cbsa: string;
  income: number;
}

async function fetchAcs(vintage: number): Promise<AcsRow[]> {
  const url = `https://api.census.gov/data/${vintage}/acs/acs1?get=NAME,B19013_001E&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:*`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ACS ${vintage} HTTP ${res.status}`);
  const rows: string[][] = await res.json();
  const out: AcsRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const [, valueStr, cbsa] = rows[i];
    const v = parseInt(valueStr, 10);
    if (Number.isFinite(v) && v > 0) out.push({ cbsa, income: v });
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
      geoId: incomeData.geographyId,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(incomeData)
    .groupBy(incomeData.geographyId);
  const countByGeo = new Map(existingCounts.map((r) => [r.geoId, Number(r.count)]));
  const toBackfill = markets.filter((m) => (countByGeo.get(m.id) ?? 0) < 2);
  console.log(`[backfill-income] ${markets.length} markets, backfilling ${toBackfill.length}`);

  const vintages = [2021, 2022, 2023];
  const byVintage = new Map<number, Map<string, number>>();
  for (const v of vintages) {
    try {
      const data = await fetchAcs(v);
      const m = new Map(data.map((r) => [r.cbsa, r.income]));
      byVintage.set(v, m);
      console.log(`  ACS ${v}: ${m.size} MSAs`);
    } catch (e) {
      console.warn(`  ACS ${v}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let inserted = 0;
  let marketsWithData = 0;
  for (const m of toBackfill) {
    const lookupCbsa = CENSUS_CBSA_OVERRIDE[m.cbsaFips] ?? m.cbsaFips;
    const sortedVintages = [...byVintage.keys()].sort((a, b) => a - b);
    let marketRows = 0;
    for (let i = 0; i < sortedVintages.length; i++) {
      const year = sortedVintages[i];
      const value = byVintage.get(year)!.get(lookupCbsa);
      if (value == null) continue;
      let yoy: number | null = null;
      if (i > 0) {
        const prior = byVintage.get(sortedVintages[i - 1])?.get(lookupCbsa);
        if (prior && prior > 0) yoy = ((value - prior) / prior) * 100;
      }
      await db
        .insert(incomeData)
        .values({
          id: randomUUID(),
          geographyId: m.id,
          year,
          medianHouseholdIncome: value,
          yoyChangePct: yoy != null ? String(yoy.toFixed(2)) : null,
          source: "census_acs_backfill",
        })
        .onConflictDoNothing();
      marketRows++;
      inserted++;
    }
    if (marketRows > 0) marketsWithData++;
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n[backfill-income] Done in ${elapsed}s`);
  console.log(`  Markets with data: ${marketsWithData}/${toBackfill.length}`);
  console.log(`  Rows inserted: ${inserted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
