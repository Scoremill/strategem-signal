/**
 * Seed the 15 MVP MSA markets into the geographies table.
 * Run: npx tsx scripts/seed-geographies.ts
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { geographies } from "../src/lib/db/schema";
import { randomUUID } from "crypto";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

const MSA_MARKETS = [
  { cbsaFips: "19100", name: "Dallas-Fort Worth-Arlington, TX", shortName: "Dallas-Fort Worth", state: "TX", lat: 32.7767, lng: -96.7970, population: 8100000 },
  { cbsaFips: "26420", name: "Houston-The Woodlands-Sugar Land, TX", shortName: "Houston", state: "TX", lat: 29.7604, lng: -95.3698, population: 7340000 },
  { cbsaFips: "12420", name: "Austin-Round Rock-Georgetown, TX", shortName: "Austin", state: "TX", lat: 30.2672, lng: -97.7431, population: 2470000 },
  { cbsaFips: "41700", name: "San Antonio-New Braunfels, TX", shortName: "San Antonio", state: "TX", lat: 29.4241, lng: -98.4936, population: 2660000 },
  { cbsaFips: "38060", name: "Phoenix-Mesa-Chandler, AZ", shortName: "Phoenix", state: "AZ", lat: 33.4484, lng: -112.0740, population: 5070000 },
  { cbsaFips: "29820", name: "Las Vegas-Henderson-North Las Vegas, NV", shortName: "Las Vegas", state: "NV", lat: 36.1699, lng: -115.1398, population: 2320000 },
  { cbsaFips: "12060", name: "Atlanta-Sandy Springs-Alpharetta, GA", shortName: "Atlanta", state: "GA", lat: 33.7490, lng: -84.3880, population: 6310000 },
  { cbsaFips: "16740", name: "Charlotte-Concord-Gastonia, NC-SC", shortName: "Charlotte", state: "NC", lat: 35.2271, lng: -80.8431, population: 2760000 },
  { cbsaFips: "39580", name: "Raleigh-Cary, NC", shortName: "Raleigh", state: "NC", lat: 35.7796, lng: -78.6382, population: 1510000 },
  { cbsaFips: "34980", name: "Nashville-Davidson-Murfreesboro-Franklin, TN", shortName: "Nashville", state: "TN", lat: 36.1627, lng: -86.7816, population: 2070000 },
  { cbsaFips: "45300", name: "Tampa-St. Petersburg-Clearwater, FL", shortName: "Tampa", state: "FL", lat: 27.9506, lng: -82.4572, population: 3340000 },
  { cbsaFips: "36740", name: "Orlando-Kissimmee-Sanford, FL", shortName: "Orlando", state: "FL", lat: 28.5383, lng: -81.3792, population: 2820000 },
  { cbsaFips: "27260", name: "Jacksonville, FL", shortName: "Jacksonville", state: "FL", lat: 30.3322, lng: -81.6557, population: 1690000 },
  { cbsaFips: "19740", name: "Denver-Aurora-Lakewood, CO", shortName: "Denver", state: "CO", lat: 39.7392, lng: -104.9903, population: 2990000 },
  { cbsaFips: "14260", name: "Boise City, ID", shortName: "Boise", state: "ID", lat: 43.6150, lng: -116.2023, population: 810000 },
];

async function main() {
  console.log("Seeding 15 MSA markets...");

  for (const msa of MSA_MARKETS) {
    await db.insert(geographies).values({
      id: randomUUID(),
      ...msa,
    }).onConflictDoNothing();
    console.log(`  ✓ ${msa.shortName} (${msa.cbsaFips})`);
  }

  console.log("Done — 15 MSAs seeded.");
}

main().catch(console.error);
