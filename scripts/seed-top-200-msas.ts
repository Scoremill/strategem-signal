/**
 * Seed the geographies table with the top 200 MSAs by population,
 * minus the 52 that already exist. One-time expansion script for
 * Phase 2.1.
 *
 * Sources:
 *   - Census ACS 1-year 2022 table B01003_001E for total population
 *     per CBSA (the most recent ACS vintage currently served)
 *   - Census TIGER Gazetteer 2023 for CBSA internal-point lat/lng
 *     (downloaded to /tmp/gaz.tsv before running this script)
 *
 * Ranks metropolitan statistical areas (micropolitans excluded)
 * by 2022 population, takes the top 200, diffs against whatever is
 * already in geographies, inserts the new rows with randomUUID ids
 * and is_active = true. Idempotent: an ON CONFLICT on cbsa_fips
 * keeps a re-run safe.
 */
import { db } from "../src/lib/db";
import { geographies } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";

interface CbsaAcsRow {
  cbsa: string;
  name: string;
  population: number;
  isMetro: boolean;
}

interface GazetteerRow {
  geoid: string;
  name: string;
  lat: number;
  lng: number;
}

interface SeedMarket {
  cbsaFips: string;
  name: string; // full ACS name
  shortName: string; // display name (first city before "-")
  state: string; // primary state
  lat: number;
  lng: number;
  population: number;
}

const ACS_URL =
  "https://api.census.gov/data/2022/acs/acs1?get=NAME,B01003_001E&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:*";

async function fetchAcsPopulations(): Promise<CbsaAcsRow[]> {
  const res = await fetch(ACS_URL);
  if (!res.ok) {
    throw new Error(`ACS API HTTP ${res.status}`);
  }
  const rows: string[][] = await res.json();
  // First row is headers: ["NAME","B01003_001E","metropolitan statistical area/micropolitan statistical area"]
  const out: CbsaAcsRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const [name, popStr, cbsa] = rows[i];
    const pop = parseInt(popStr, 10);
    if (!Number.isFinite(pop) || pop <= 0) continue;
    out.push({
      cbsa,
      name,
      population: pop,
      isMetro: name.includes("Metro Area"),
    });
  }
  return out;
}

function loadGazetteer(path: string): Map<string, GazetteerRow> {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const headers = lines[0].split("\t").map((h) => h.trim());
  const geoidIdx = headers.indexOf("GEOID");
  const nameIdx = headers.indexOf("NAME");
  const latIdx = headers.indexOf("INTPTLAT");
  const lngIdx = headers.indexOf("INTPTLONG");
  if (geoidIdx === -1 || latIdx === -1 || lngIdx === -1) {
    throw new Error(
      `Gazetteer header missing expected columns (GEOID, NAME, INTPTLAT, INTPTLONG)`
    );
  }
  const out = new Map<string, GazetteerRow>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t").map((c) => c.trim());
    out.set(cols[geoidIdx], {
      geoid: cols[geoidIdx],
      name: cols[nameIdx],
      lat: parseFloat(cols[latIdx]),
      lng: parseFloat(cols[lngIdx]),
    });
  }
  return out;
}

/**
 * Derive a display-friendly short name from the full ACS name.
 * "Dallas-Fort Worth-Arlington, TX Metro Area" → "Dallas-Fort Worth"
 * "New York-Newark-Jersey City, NY-NJ-PA Metro Area" → "New York"
 *
 * Rule: everything before the first comma, then drop any segment
 * after the second "-" (so "Dallas-Fort Worth-Arlington" becomes
 * "Dallas-Fort Worth" — two-segment compound names stay intact,
 * three-segment names trim the third).
 */
function deriveShortName(fullName: string): string {
  const beforeComma = fullName.split(",")[0].trim();
  const parts = beforeComma.split("-");
  if (parts.length >= 3) return parts.slice(0, 2).join("-");
  return beforeComma;
}

/**
 * Extract the primary state from the full ACS name.
 * "Dallas-Fort Worth-Arlington, TX Metro Area" → "TX"
 * "New York-Newark-Jersey City, NY-NJ-PA Metro Area" → "NY"
 * "Washington-Arlington-Alexandria, DC-VA-MD-WV Metro Area" → "DC"
 */
function deriveState(fullName: string): string {
  const afterComma = fullName.split(",")[1]?.trim() ?? "";
  const stateToken = afterComma.replace(/Metro Area|Micro Area/g, "").trim();
  return stateToken.split("-")[0] ?? "";
}

async function main() {
  console.log("Fetching ACS populations...");
  const acs = await fetchAcsPopulations();
  console.log(`Got ${acs.length} CBSAs from ACS`);

  console.log("Loading Gazetteer coordinates from /tmp/gaz.tsv...");
  const gaz = loadGazetteer("/tmp/gaz.tsv");
  console.log(`Got ${gaz.size} Gazetteer rows`);

  // Metros only, sorted by population desc
  const metros = acs
    .filter((r) => r.isMetro)
    .sort((a, b) => b.population - a.population);
  console.log(`${metros.length} metros total`);

  // Top 200
  const top200 = metros.slice(0, 200);
  console.log(`Top 200 population range: ${top200[0].population.toLocaleString()} → ${top200[199].population.toLocaleString()}`);
  console.log(`#1: ${top200[0].name}`);
  console.log(`#200: ${top200[199].name}`);

  // Existing rows
  const existingRows = await db.select().from(geographies);
  const existingCbsas = new Set(existingRows.map((r) => r.cbsaFips));
  console.log(`\n${existingRows.length} existing geographies rows`);

  // Build the seed list — top 200 minus existing, enriched with gazetteer coordinates
  const seeds: SeedMarket[] = [];
  const missingCoords: string[] = [];
  for (const metro of top200) {
    if (existingCbsas.has(metro.cbsa)) continue;
    const g = gaz.get(metro.cbsa);
    if (!g || !Number.isFinite(g.lat) || !Number.isFinite(g.lng)) {
      missingCoords.push(`${metro.cbsa} ${metro.name}`);
      continue;
    }
    seeds.push({
      cbsaFips: metro.cbsa,
      name: metro.name.replace(" Metro Area", "").trim(),
      shortName: deriveShortName(metro.name),
      state: deriveState(metro.name),
      lat: g.lat,
      lng: g.lng,
      population: metro.population,
    });
  }

  console.log(`\n${seeds.length} new markets to seed`);
  if (missingCoords.length > 0) {
    console.warn(`\n${missingCoords.length} markets missing gazetteer coordinates — will skip:`);
    for (const m of missingCoords) console.warn(`  ${m}`);
  }

  // Sample the first 5 so we can eyeball before inserting
  console.log("\nSample seeds:");
  for (const s of seeds.slice(0, 5)) {
    console.log(
      `  ${s.cbsaFips}  ${s.shortName.padEnd(30)}  ${s.state}  ${s.lat.toFixed(4)},${s.lng.toFixed(4)}  pop ${s.population.toLocaleString()}`
    );
  }

  // Insert in batches (Drizzle neon-http handles bulk inserts fine)
  console.log(`\nInserting ${seeds.length} rows...`);
  let inserted = 0;
  for (const s of seeds) {
    try {
      await db
        .insert(geographies)
        .values({
          id: randomUUID(),
          cbsaFips: s.cbsaFips,
          name: s.name,
          shortName: s.shortName,
          state: s.state,
          lat: s.lat,
          lng: s.lng,
          population: s.population,
          isActive: true,
        })
        .onConflictDoNothing();
      inserted++;
    } catch (err) {
      console.error(
        `  ✗ ${s.cbsaFips} ${s.shortName}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.log(`\nInserted ${inserted} new rows`);

  // Final sanity check — count active rows
  const finalCount = await db
    .select()
    .from(geographies)
    .where(eq(geographies.isActive, true));
  console.log(`Total active geographies: ${finalCount.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
