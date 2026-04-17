/**
 * Local backfill script for demand data (permits + employment + population).
 * Runs outside Vercel to avoid the 300s timeout.
 *
 * Usage: npx tsx scripts/backfill-demand.ts
 */
import * as fs from "fs";
import * as path from "path";

// Load .env.local
const envPath = path.resolve(__dirname, "../.env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  const val = trimmed.slice(eq + 1);
  if (!process.env[key]) process.env[key] = val;
}

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL!;
const BLS_API_KEY = process.env.BLS_API_KEY!;
const sql = neon(DATABASE_URL);

// ─── Census BPS permits ─────────────────────────────────────────

async function backfillPermits() {
  console.log("\n═══ PERMITS (Census BPS) ═══");

  // Get all active geographies
  const geos = await sql`SELECT id, cbsa_fips, short_name FROM geographies WHERE is_active = true ORDER BY short_name`;
  const cbsaToGeoId = new Map(geos.map((g: any) => [g.cbsa_fips, g.id]));
  console.log(`Markets: ${geos.length}`);

  const XLSX = await import("xlsx");
  const now = new Date();
  let totalInserted = 0;

  for (let i = 0; i < 24; i++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i - 2);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const ym = `${year}${String(month).padStart(2, "0")}`;

    let url = `https://www.census.gov/construction/bps/xls/cbsamonthly_${ym}.xls`;
    let res = await fetch(url);
    if (res.status === 404) {
      url = `https://www.census.gov/construction/bps/xls/msamonthly_${ym}.xls`;
      res = await fetch(url);
    }
    if (!res.ok || (res.headers.get("content-type") || "").includes("text/html")) {
      console.log(`  ${ym}: not available`);
      continue;
    }

    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets["CBSA Units"] ?? wb.Sheets["MSA Units"];
    if (!sheet) { console.log(`  ${ym}: no sheet`); continue; }

    const grid = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: true, defval: null });
    let monthInserted = 0;

    const periodDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const values: any[] = [];

    for (const row of grid) {
      if (!row || row.length < 9) continue;
      const cbsa = row[1];
      if (typeof cbsa !== "number" && typeof cbsa !== "string") continue;
      if (typeof row[2] !== "string") continue;
      const cbsaStr = String(cbsa).padStart(5, "0");
      if (!/^\d{5}$/.test(cbsaStr)) continue;

      const geoId = cbsaToGeoId.get(cbsaStr);
      if (!geoId) continue;

      const total = toInt(row[4]);
      const sf = toInt(row[5]);
      const mf = total !== null && sf !== null ? total - sf : null;
      if (total === null) continue;

      values.push({ geoId, periodDate, total, sf, mf });
    }

    // Batch insert
    for (const v of values) {
      try {
        await sql`INSERT INTO permit_data (id, geography_id, period_date, total_permits, single_family, multi_family, source)
          VALUES (gen_random_uuid(), ${v.geoId}, ${v.periodDate}, ${v.total}, ${v.sf}, ${v.mf}, 'census_bps')
          ON CONFLICT DO NOTHING`;
        monthInserted++;
      } catch { /* skip duplicates */ }
    }

    totalInserted += monthInserted;
    console.log(`  ${ym}: ${monthInserted} rows`);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`Total permits inserted: ${totalInserted}`);
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? Math.round(v) : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

// ─── BLS CES employment ─────────────────────────────────────────

const STATE_FIPS: Record<string, string> = {
  AL:"01",AK:"02",AZ:"04",AR:"05",CA:"06",CO:"08",CT:"09",DE:"10",DC:"11",
  FL:"12",GA:"13",HI:"15",ID:"16",IL:"17",IN:"18",IA:"19",KS:"20",KY:"21",
  LA:"22",ME:"23",MD:"24",MA:"25",MI:"26",MN:"27",MS:"28",MO:"29",MT:"30",
  NE:"31",NV:"32",NH:"33",NJ:"34",NM:"35",NY:"36",NC:"37",ND:"38",OH:"39",
  OK:"40",OR:"41",PA:"42",PR:"72",RI:"44",SC:"45",SD:"46",TN:"47",TX:"48",
  UT:"49",VT:"50",VA:"51",WA:"53",WV:"54",WI:"55",WY:"56",
};

async function backfillEmployment() {
  console.log("\n═══ EMPLOYMENT (BLS CES + LAUS) ═══");

  const geos = await sql`SELECT id, cbsa_fips, short_name, state FROM geographies WHERE is_active = true ORDER BY short_name`;
  console.log(`Markets: ${geos.length}`);

  const now = new Date();
  const startYear = now.getFullYear() - 2;
  const endYear = now.getFullYear();

  // Build CES series
  const cesMeta: Array<{ seriesId: string; geoId: string; name: string }> = [];
  const lausMeta: Array<{ seriesId: string; geoId: string }> = [];

  for (const g of geos) {
    const stateFips = STATE_FIPS[(g as any).state];
    if (!stateFips) continue;
    const cbsa = (g as any).cbsa_fips;
    cesMeta.push({
      seriesId: `SMS${stateFips}${cbsa}0000000001`,
      geoId: (g as any).id,
      name: (g as any).short_name,
    });
    lausMeta.push({
      seriesId: `LAUMT${stateFips}${cbsa.slice(0, 4)}000000003`,
      geoId: (g as any).id,
    });
  }

  // Fetch CES in batches of 50
  let totalInserted = 0;
  const cesMap = new Map(cesMeta.map(m => [m.seriesId, m]));
  const lausMap = new Map(lausMeta.map(m => [m.seriesId, m]));

  console.log(`Fetching CES (${cesMeta.length} series in ${Math.ceil(cesMeta.length/50)} batches)...`);
  const cesResults = await fetchBlsBatched(cesMeta.map(m => m.seriesId), startYear, endYear);

  console.log(`Fetching LAUS (${lausMeta.length} series in ${Math.ceil(lausMeta.length/50)} batches)...`);
  const lausResults = await fetchBlsBatched(lausMeta.map(m => m.seriesId), startYear, endYear);

  // Index LAUS by geoId → date → rate
  const lausByGeo = new Map<string, Map<string, number>>();
  for (const [sid, obs] of lausResults) {
    const meta = lausMap.get(sid);
    if (!meta) continue;
    const dateMap = new Map<string, number>();
    for (const o of obs) {
      const rate = parseFloat(o.value);
      if (Number.isFinite(rate)) dateMap.set(o.date, rate);
    }
    lausByGeo.set(meta.geoId, dateMap);
  }

  // Insert
  for (const [sid, obs] of cesResults) {
    const meta = cesMap.get(sid);
    if (!meta) continue;
    const geoLaus = lausByGeo.get(meta.geoId);

    for (const o of obs) {
      const nonfarm = Math.round(parseFloat(o.value) * 1000);
      if (!Number.isFinite(nonfarm) || nonfarm <= 0) continue;
      const ur = geoLaus?.get(o.date);
      const urStr = ur != null ? String(ur) : null;

      try {
        await sql`INSERT INTO employment_data (id, geography_id, period_date, total_nonfarm, unemployment_rate, source)
          VALUES (gen_random_uuid(), ${meta.geoId}, ${o.date}, ${nonfarm}, ${urStr}, 'bls_ces')
          ON CONFLICT DO NOTHING`;
        if (urStr) {
          await sql`UPDATE employment_data SET unemployment_rate = ${urStr}
            WHERE geography_id = ${meta.geoId} AND period_date = ${o.date}`;
        }
        totalInserted++;
      } catch { /* skip */ }
    }
  }

  console.log(`Total employment inserted: ${totalInserted}`);
  console.log(`CES series with data: ${cesResults.size}/${cesMeta.length}`);
  console.log(`LAUS series with data: ${lausResults.size}/${lausMeta.length}`);
}

interface BlsObs { date: string; value: string }

async function fetchBlsBatched(
  seriesIds: string[], startYear: number, endYear: number
): Promise<Map<string, BlsObs[]>> {
  const result = new Map<string, BlsObs[]>();
  const chunks: string[][] = [];
  for (let i = 0; i < seriesIds.length; i += 50) {
    chunks.push(seriesIds.slice(i, i + 50));
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    console.log(`  Batch ${ci+1}/${chunks.length} (${chunk.length} series)...`);

    const payload = {
      seriesid: chunk,
      startyear: String(startYear),
      endyear: String(endYear),
      registrationkey: BLS_API_KEY,
    };

    const res = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`  BLS API error ${res.status}`);
      continue;
    }

    const data = await res.json();
    if (data.status !== "REQUEST_SUCCEEDED") {
      console.error(`  BLS API failed: ${data.message?.join("; ")}`);
      continue;
    }

    for (const series of data.Results.series) {
      const obs: BlsObs[] = [];
      for (const d of series.data) {
        if (d.period === "M13") continue;
        const monthNum = parseInt(d.period.replace("M", ""), 10);
        if (monthNum < 1 || monthNum > 12) continue;
        obs.push({
          date: `${d.year}-${String(monthNum).padStart(2, "0")}-01`,
          value: d.value,
        });
      }
      obs.sort((a, b) => a.date.localeCompare(b.date));
      if (obs.length > 0) result.set(series.seriesID, obs);
    }

    // BLS rate limit: 500 queries/day, be polite between batches
    await new Promise(r => setTimeout(r, 2000));
  }

  return result;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log("Demand data backfill — local script\n");
  console.log(`Database: ${DATABASE_URL.split("@")[1]?.split("/")[0] ?? "connected"}`);

  await backfillPermits();
  await backfillEmployment();

  // Verify coverage
  const coverage = await sql`
    SELECT
      (SELECT COUNT(DISTINCT geography_id) FROM permit_data) as permits,
      (SELECT COUNT(DISTINCT geography_id) FROM employment_data) as employment,
      (SELECT COUNT(DISTINCT geography_id) FROM migration_data) as migration,
      (SELECT COUNT(*) FROM geographies WHERE is_active = true) as total
  `;
  console.log("\n═══ COVERAGE ═══");
  console.log(`Permits: ${coverage[0].permits}/${coverage[0].total}`);
  console.log(`Employment: ${coverage[0].employment}/${coverage[0].total}`);
  console.log(`Migration: ${coverage[0].migration}/${coverage[0].total}`);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
