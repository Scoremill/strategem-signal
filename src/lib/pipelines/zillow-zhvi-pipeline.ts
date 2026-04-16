/**
 * Zillow ZHVI (Home Value Index) pipeline.
 *
 * Downloads the metro CSV once per run (~4 MB), parses it, and upserts
 * monthly dollar values into zillow_zhvi for every matched geography.
 * Matching strategy: compare each geography's first-city-before-the-hyphen
 * + state against Zillow's RegionName first-city + state. An explicit
 * override table handles the handful of metros where Zillow and OMB
 * disagree on the primary city (Boise → Boise City, Dayton-Kettering →
 * Dayton, Prescott Valley-Prescott → Prescott Valley, etc.).
 *
 * Puerto Rico metros (Aguadilla, San Juan) are not covered by Zillow
 * and are treated as expected gaps, consistent with FHFA.
 *
 * The cron only writes the latest N months per metro to keep runs fast.
 * The initial backfill script writes the full 2023-present history.
 */
import { db } from "@/lib/db";
import { geographies, zillowZhvi } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const ZILLOW_URL =
  "https://files.zillowstatic.com/research/public_csvs/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv";

/**
 * Zillow uses a different primary city than OMB for a handful of metros.
 * Key: `<shortName_lowercase>|<state>` so compound hyphenated names
 * match. Value: the Zillow first-city string (lowercase).
 *
 * Known uncoverable gaps (no Zillow entry at all, so no override helps):
 *   - Puerto Rico metros (Aguadilla, San Juan) — Zillow doesn't cover PR
 *   - Dayton-Kettering OH — not in Zillow's metro feed (only Dayton, TN)
 *   - Prescott Valley-Prescott AZ — not in Zillow's metro feed
 * Total: 4 unmatched of 199 (98% coverage), consistent with FHFA gaps.
 */
const ZILLOW_OVERRIDE: Record<string, string> = {
  "boise|ID": "boise city",
  "fort myers|FL": "cape coral", // OMB primary is Cape Coral-Fort Myers; Zillow uses Cape Coral
  "washington dc|DC": "washington",
};

export interface ZillowPipelineResult {
  marketsProcessed: number;
  marketsMatched: number;
  rowsInserted: number;
  unmatched: string[];
  errors: string[];
}

interface ZillowPipelineOptions {
  /**
   * If set, only write rows whose period_date is >= this ISO date.
   * Defaults to "2023-01-01" for the first backfill; the monthly
   * cron passes the first of the current month to keep runs small.
   */
  minDate?: string;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Convert Zillow's month-end date header ("2026-02-28") to our canonical
 * month-start format ("2026-02-01") so it aligns with permit_data and
 * employment_data which use the first of the month.
 */
function normalizeMonthDate(header: string): string | null {
  const match = header.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-01`;
}

/**
 * Build the lookup key used for matching. Our short_name might be
 * "Dallas-Fort Worth" (first city "dallas") or "Fort Myers" (first
 * city "fort myers") — we keep hyphens within multi-word city names
 * but strip hyphenated secondary cities the way we'd parse for
 * display. The override table handles the weird cases.
 */
function buildLookupKey(firstCityLower: string, state: string): string {
  return `${firstCityLower}|${state}`;
}

function deriveFirstCity(shortName: string): string {
  // "Dallas-Fort Worth" → "dallas"
  // "Fort Myers" → "fort myers" (no hyphens)
  // "Prescott Valley-Prescott" → "prescott valley"
  return shortName.split("-")[0].toLowerCase().trim();
}

/**
 * Core pipeline — run once against the live DB. Safe to re-run;
 * upserts on (geography_id, period_date).
 */
export async function runZillowZhviPipeline(
  options: ZillowPipelineOptions = {}
): Promise<ZillowPipelineResult> {
  const minDate = options.minDate ?? "2023-01-01";
  const result: ZillowPipelineResult = {
    marketsProcessed: 0,
    marketsMatched: 0,
    rowsInserted: 0,
    unmatched: [],
    errors: [],
  };

  console.log("[zillow-zhvi] Downloading metro CSV...");
  const res = await fetch(ZILLOW_URL);
  if (!res.ok) throw new Error(`Zillow HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  console.log(
    `  ${lines.length - 1} rows, header has ${header.length} columns, latest month: ${header[header.length - 1]}`
  );

  // Build Zillow lookup keyed by firstCity + state. The CSV has ~894
  // metros; we keep all of them in memory since our matching phase
  // needs random access.
  //
  // Each value is an array of { periodDate, price } tuples covering
  // every month >= minDate in the header.
  type ZillowEntry = {
    regionName: string;
    prices: Array<{ periodDate: string; price: number }>;
  };
  const zillowLookup = new Map<string, ZillowEntry>();

  // Precompute which header columns we care about (monthly prices >= minDate)
  const monthColumns: Array<{ idx: number; periodDate: string }> = [];
  for (let c = 0; c < header.length; c++) {
    const norm = normalizeMonthDate(header[c]);
    if (!norm) continue;
    if (norm < minDate) continue;
    monthColumns.push({ idx: c, periodDate: norm });
  }
  console.log(`  Writing ${monthColumns.length} monthly columns per market (>= ${minDate})`);

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols[3] !== "msa") continue;
    const regionName = cols[2];
    const match = regionName.match(/^(.+),\s*([A-Z]{2})$/);
    if (!match) continue;
    const firstCity = match[1].split("-")[0].toLowerCase().trim();
    const state = match[2];

    const prices: ZillowEntry["prices"] = [];
    for (const { idx, periodDate } of monthColumns) {
      const raw = cols[idx];
      if (!raw || raw === "") continue;
      const v = parseFloat(raw);
      if (!Number.isFinite(v) || v <= 0) continue;
      prices.push({ periodDate, price: Math.round(v) });
    }
    if (prices.length === 0) continue;

    const key = buildLookupKey(firstCity, state);
    zillowLookup.set(key, { regionName, prices });
  }
  console.log(`  Parsed ${zillowLookup.size} Zillow metros with data`);

  // Match each active geography to its Zillow entry and upsert rows
  const geos = await db
    .select({
      id: geographies.id,
      cbsaFips: geographies.cbsaFips,
      shortName: geographies.shortName,
      state: geographies.state,
    })
    .from(geographies)
    .where(eq(geographies.isActive, true));
  console.log(`  ${geos.length} active markets to match`);

  for (const g of geos) {
    result.marketsProcessed++;

    // Check the override by the FULL short_name first (so hyphenated
    // compound names match), then fall back to first-city-lowercase.
    const shortNameKey = `${g.shortName.toLowerCase()}|${g.state}`;
    const overrideCity = ZILLOW_OVERRIDE[shortNameKey];
    const naiveFirstCity = deriveFirstCity(g.shortName);
    const zillowEntry = overrideCity
      ? zillowLookup.get(buildLookupKey(overrideCity, g.state))
      : zillowLookup.get(buildLookupKey(naiveFirstCity, g.state));

    if (!zillowEntry) {
      result.unmatched.push(`${g.shortName}, ${g.state}`);
      continue;
    }
    result.marketsMatched++;

    for (const { periodDate, price } of zillowEntry.prices) {
      try {
        await db
          .insert(zillowZhvi)
          .values({
            id: randomUUID(),
            geographyId: g.id,
            periodDate,
            medianHomeValue: price,
          })
          .onConflictDoUpdate({
            target: [zillowZhvi.geographyId, zillowZhvi.periodDate],
            set: {
              medianHomeValue: price,
              fetchedAt: new Date(),
            },
          });
        result.rowsInserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${g.shortName}/${periodDate}: ${msg}`);
      }
    }
  }

  console.log(
    `[zillow-zhvi] Done: ${result.marketsMatched}/${result.marketsProcessed} matched, ${result.rowsInserted} rows, ${result.errors.length} errors`
  );
  return result;
}
