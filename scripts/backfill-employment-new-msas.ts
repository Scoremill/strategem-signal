/**
 * Backfill employment_data 2023-2025 for every market that doesn't
 * already have employment rows. Uses BLS Public Data API v2 directly
 * (the existing demand pipeline uses FRED which lacks MSA coverage for
 * smaller metros).
 *
 * BLS MSA series ID formats:
 *   CES total nonfarm SA: SMU{state_fips:2}{cbsa:5}000000000001
 *   LAUS unemployment rate: LAUMT{state_fips:2}{cbsa:5}000000003
 *
 * The state fips is the PRIMARY state for the MSA per BLS's internal
 * mapping. We derive it from the CBSA→primary state mapping maintained
 * in the geographies table.
 *
 * BLS limit: 50 series per request, 500 requests/day with a registered
 * key. 199 markets × 2 series = 398 series = 8 batches. ~1 minute.
 */
import { db } from "../src/lib/db";
import { geographies, employmentData } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

// State abbreviation → FIPS code (2-digit string)
const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09",
  DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17",
  IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24",
  MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31",
  NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38",
  OH: "39", OK: "40", OR: "41", PA: "42", PR: "72", RI: "44", SC: "45",
  SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53",
  WV: "54", WI: "55", WY: "56",
};

interface BlsObservation {
  year: string;
  period: string; // "M01".."M12"
  value: string;
}

interface BlsSeriesResult {
  seriesID: string;
  data: BlsObservation[];
}

interface BlsResponse {
  status: string;
  Results?: { series: BlsSeriesResult[] };
  message?: string[];
}

async function fetchBls(
  seriesIds: string[],
  startYear: number,
  endYear: number
): Promise<Map<string, BlsObservation[]>> {
  const apiKey = process.env.BLS_API_KEY;
  const res = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seriesid: seriesIds,
      startyear: String(startYear),
      endyear: String(endYear),
      registrationkey: apiKey,
    }),
  });
  if (!res.ok) throw new Error(`BLS HTTP ${res.status}`);
  const data: BlsResponse = await res.json();
  if (data.status !== "REQUEST_SUCCEEDED") {
    throw new Error(`BLS status: ${data.status}: ${(data.message || []).join("; ")}`);
  }
  const out = new Map<string, BlsObservation[]>();
  for (const s of data.Results?.series ?? []) {
    out.set(s.seriesID, s.data);
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function periodToDate(year: string, period: string): string | null {
  if (!period.startsWith("M")) return null;
  const month = parseInt(period.slice(1), 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-01`;
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
      geoId: employmentData.geographyId,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(employmentData)
    .groupBy(employmentData.geographyId);
  const countByGeo = new Map(existingCounts.map((r) => [r.geoId, Number(r.count)]));
  const toBackfill = markets.filter((m) => (countByGeo.get(m.id) ?? 0) < 10);
  console.log(`[backfill-employment] ${markets.length} markets, backfilling ${toBackfill.length}`);

  // Build series → geographyId mapping. Two series per market.
  interface SeriesMap {
    seriesId: string;
    geographyId: string;
    cbsaFips: string;
    shortName: string;
    kind: "ces" | "laus";
  }
  const seriesMaps: SeriesMap[] = [];
  const skipped: string[] = [];
  for (const m of toBackfill) {
    const sfips = STATE_FIPS[m.state];
    if (!sfips) {
      skipped.push(`${m.shortName} ${m.state} (no state fips)`);
      continue;
    }
    // BLS series ID formats (confirmed via direct probe):
    //   CES total nonfarm SA:  SMU{state:2}{cbsa:5}00000000001  (11-char trailing)
    //   LAUS unemployment rate: LAUMT{state:2}{cbsa:5}00000003   (8-char trailing)
    const cesId = `SMU${sfips}${m.cbsaFips}00000000001`;
    const lausId = `LAUMT${sfips}${m.cbsaFips}00000003`;
    seriesMaps.push({ seriesId: cesId, geographyId: m.id, cbsaFips: m.cbsaFips, shortName: m.shortName, kind: "ces" });
    seriesMaps.push({ seriesId: lausId, geographyId: m.id, cbsaFips: m.cbsaFips, shortName: m.shortName, kind: "laus" });
  }
  console.log(`  ${seriesMaps.length} series to fetch in batches of 50 (${skipped.length} skipped)`);

  const batches = chunk(seriesMaps, 50);
  const allData = new Map<string, BlsObservation[]>();
  for (let b = 0; b < batches.length; b++) {
    try {
      const ids = batches[b].map((s) => s.seriesId);
      const result = await fetchBls(ids, 2023, 2025);
      for (const [k, v] of result) allData.set(k, v);
      let withRows = 0;
      for (const [, v] of result) if (v.length > 0) withRows++;
      console.log(`  batch ${b + 1}/${batches.length}: ${result.size} series returned, ${withRows} with rows`);
    } catch (e) {
      console.warn(`  batch ${b + 1} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Write per market per month. For each market, find its two series,
  // build a period-keyed map of { nonfarm, unemploymentRate }, insert rows.
  const byGeo = new Map<string, { ces?: BlsObservation[]; laus?: BlsObservation[]; shortName: string }>();
  for (const sm of seriesMaps) {
    const obs = allData.get(sm.seriesId);
    if (!obs || obs.length === 0) continue;
    const entry = byGeo.get(sm.geographyId) ?? { shortName: sm.shortName };
    entry[sm.kind] = obs;
    byGeo.set(sm.geographyId, entry);
  }

  let inserted = 0;
  let marketsWithData = 0;
  for (const [geoId, data] of byGeo) {
    const ces = data.ces ?? [];
    const laus = data.laus ?? [];
    // Build a map of period → { nonfarm, unemploymentRate }
    const byPeriod = new Map<string, { nonfarm?: number; unemp?: number }>();
    for (const o of ces) {
      const date = periodToDate(o.year, o.period);
      if (!date) continue;
      const n = parseInt(o.value, 10);
      if (!Number.isFinite(n)) continue;
      const entry = byPeriod.get(date) ?? {};
      entry.nonfarm = n * 1000; // CES is reported in thousands
      byPeriod.set(date, entry);
    }
    for (const o of laus) {
      const date = periodToDate(o.year, o.period);
      if (!date) continue;
      const u = parseFloat(o.value);
      if (!Number.isFinite(u)) continue;
      const entry = byPeriod.get(date) ?? {};
      entry.unemp = u;
      byPeriod.set(date, entry);
    }

    let marketRows = 0;
    for (const [date, v] of byPeriod) {
      if (v.nonfarm == null && v.unemp == null) continue;
      await db
        .insert(employmentData)
        .values({
          id: randomUUID(),
          geographyId: geoId,
          periodDate: date,
          totalNonfarm: v.nonfarm ?? null,
          constructionEmployment: null,
          unemploymentRate: v.unemp != null ? String(v.unemp.toFixed(1)) : null,
          source: "bls_direct_backfill",
        })
        .onConflictDoNothing();
      marketRows++;
      inserted++;
    }
    if (marketRows > 0) marketsWithData++;
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n[backfill-employment] Done in ${elapsed}s`);
  console.log(`  Markets with data: ${marketsWithData}/${toBackfill.length}`);
  console.log(`  Rows inserted: ${inserted}`);
  if (skipped.length > 0) {
    console.log(`  Skipped (missing state fips): ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "..." : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
