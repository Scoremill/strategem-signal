/**
 * Seed 9 additional MSA markets (43 → 52).
 * Markets verified addable by scripts/probe-9-markets.ts.
 * Run: npx tsx scripts/seed-9-markets.ts
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { geographies } from "../src/lib/db/schema";
import { randomUUID } from "crypto";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

const NEW_MARKETS = [
  // Tier 1 — clean MSA-level capacity + FRED demand
  { cbsaFips: "38300", name: "Pittsburgh, PA",                            shortName: "Pittsburgh",   state: "PA", lat: 40.4406, lng: -79.9959, population: 2370000 },
  { cbsaFips: "46060", name: "Tucson, AZ",                                shortName: "Tucson",       state: "AZ", lat: 32.2226, lng: -110.9747, population: 1050000 },

  // Tier 2 — MSA-level FRED demand, capacity needs county aggregation
  { cbsaFips: "28140", name: "Kansas City, MO-KS",                        shortName: "Kansas City",  state: "MO", lat: 39.0997, lng: -94.5786, population: 2200000 },
  { cbsaFips: "40060", name: "Richmond, VA",                              shortName: "Richmond",     state: "VA", lat: 37.5407, lng: -77.4360, population: 1320000 },
  { cbsaFips: "13820", name: "Birmingham-Hoover, AL",                     shortName: "Birmingham",   state: "AL", lat: 33.5186, lng: -86.8104, population: 1110000 },
  { cbsaFips: "32820", name: "Memphis, TN-MS-AR",                         shortName: "Memphis",      state: "TN", lat: 35.1495, lng: -90.0490, population: 1340000 },
  { cbsaFips: "10740", name: "Albuquerque, NM",                           shortName: "Albuquerque",  state: "NM", lat: 35.0844, lng: -106.6504, population: 920000 },

  // Tier 3 — both demand permits AND capacity need county aggregation
  { cbsaFips: "30780", name: "Little Rock-North Little Rock-Conway, AR",  shortName: "Little Rock",  state: "AR", lat: 34.7465, lng: -92.2896, population: 750000 },
  { cbsaFips: "27140", name: "Jackson, MS",                               shortName: "Jackson",      state: "MS", lat: 32.2988, lng: -90.1848, population: 590000 },
];

async function main() {
  console.log(`Seeding ${NEW_MARKETS.length} new MSA markets...`);

  for (const msa of NEW_MARKETS) {
    await db.insert(geographies).values({
      id: randomUUID(),
      ...msa,
    }).onConflictDoNothing();
    console.log(`  ✓ ${msa.shortName} (${msa.cbsaFips})`);
  }

  console.log(`Done — ${NEW_MARKETS.length} MSAs seeded.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
