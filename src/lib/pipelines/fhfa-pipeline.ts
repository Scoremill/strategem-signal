/**
 * FHFA House Price Index pipeline.
 *
 * Downloads the full metro CSV from FHFA once per run (~3 MB, fast)
 * and upserts rows into fhfa_hpi for every active geography. The
 * pipeline handles the FHFA metropolitan-division quirk: 13 of the
 * largest CBSAs in our universe are split into divisions in the FHFA
 * data (Dallas is 19124 not 19100, New York is 35614 not 35620, etc.),
 * so we map the "primary division" when the OMB CBSA isn't directly
 * covered.
 *
 * Used by the monthly cron at /api/cron/fhfa and the one-shot backfill
 * at scripts/backfill-fhfa.ts (which is just a synonym for "run once
 * with all history in range").
 */
import { db } from "@/lib/db";
import { geographies, fhfaHpi } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const FHFA_METRO_CSV_URL =
  "https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_metro.csv";

/**
 * FHFA uses metropolitan division (MSAD) codes for the 11 largest US
 * CBSAs instead of the OMB CBSA code. Map our canonical CBSA to the
 * FHFA-used code. The "primary" division is the one containing the
 * headline city of the metro. A handful of CBSAs use different codes
 * entirely (Cleveland 17460 → 17410, same drift as Census ACS).
 *
 * Maintained by hand because FHFA changes rarely (once every decade
 * on average, tied to OMB redefinitions).
 */
const FHFA_CBSA_OVERRIDE: Record<string, string> = {
  "12060": "12054", // Atlanta → Atlanta-Sandy Springs-Roswell MSAD
  "14460": "14454", // Boston → Boston MSAD (not the full NECTA)
  "16980": "16984", // Chicago → Chicago-Naperville-Schaumburg MSAD
  "17460": "17410", // Cleveland-Elyria → Cleveland (post-2018 code)
  "19100": "19124", // Dallas-Fort Worth → Dallas-Plano-Irving MSAD
  "19820": "19804", // Detroit → Detroit-Dearborn-Livonia MSAD
  "31080": "31084", // Los Angeles → Los Angeles-Long Beach-Glendale MSAD
  "33100": "33124", // Miami → Miami-Miami Beach-Kendall MSAD
  "35620": "35614", // New York → New York-Jersey City-White Plains MSAD
  "37980": "37964", // Philadelphia → Philadelphia MSAD
  "41860": "41884", // San Francisco → San Francisco-San Mateo-Redwood City MSAD
  "42660": "42644", // Seattle → Seattle-Bellevue-Kent MSAD
  "45300": "45294", // Tampa → Tampa MSAD
  "47900": "47764", // Washington DC → Washington DC-MD MSAD
  // Puerto Rico metros (10380 Aguadilla, 41980 San Juan) are NOT
  // covered by FHFA. Nothing to override.
};

interface FhfaRow {
  cbsa: string;
  year: number;
  quarter: number;
  hpi: number;
}

export interface FhfaPipelineResult {
  marketsProcessed: number;
  marketsWithData: number;
  rowsInserted: number;
  errors: string[];
}

interface FhfaPipelineOptions {
  /** If set, only keep rows in this year range (inclusive). Defaults
   *  to 2023-present so we don't write 50 years of history on every
   *  cron run. */
  minYear?: number;
}

/**
 * Download and parse the FHFA metro CSV. Returns rows keyed by
 * FHFA CBSA/MSAD code.
 */
async function fetchFhfaMetroCsv(minYear: number): Promise<Map<string, FhfaRow[]>> {
  const res = await fetch(FHFA_METRO_CSV_URL);
  if (!res.ok) throw new Error(`FHFA CSV HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split("\n");
  // FHFA metro format: "Metro Name",CBSA,year,quarter,hpi,se
  // Both "-" and the se value can appear. We want rows with numeric hpi.
  const byCbsa = new Map<string, FhfaRow[]>();
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseFhfaLine(line);
    if (cols.length < 5) continue;
    const cbsa = cols[1];
    const year = parseInt(cols[2], 10);
    const quarter = parseInt(cols[3], 10);
    const hpiRaw = cols[4];
    if (!Number.isFinite(year) || !Number.isFinite(quarter)) continue;
    if (year < minYear) continue;
    if (hpiRaw === "-") continue;
    const hpi = parseFloat(hpiRaw);
    if (!Number.isFinite(hpi)) continue;
    const arr = byCbsa.get(cbsa) ?? [];
    arr.push({ cbsa, year, quarter, hpi });
    byCbsa.set(cbsa, arr);
  }
  return byCbsa;
}

/**
 * Parse a single FHFA CSV line. The metro name is quoted (and contains
 * commas); everything else is unquoted. We handle the quoted field
 * explicitly rather than using a full CSV parser.
 */
function parseFhfaLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      const end = line.indexOf('"', i + 1);
      if (end === -1) break;
      out.push(line.slice(i + 1, end));
      i = end + 2; // skip trailing comma
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) {
        out.push(line.slice(i).trim());
        break;
      }
      out.push(line.slice(i, end).trim());
      i = end + 1;
    }
  }
  return out;
}

/**
 * Run the FHFA pipeline against the live DB. Idempotent — re-running
 * is safe (ON CONFLICT DO UPDATE refreshes any changed HPI values).
 */
export async function runFhfaPipeline(
  options: FhfaPipelineOptions = {}
): Promise<FhfaPipelineResult> {
  const minYear = options.minYear ?? 2023;
  const result: FhfaPipelineResult = {
    marketsProcessed: 0,
    marketsWithData: 0,
    rowsInserted: 0,
    errors: [],
  };

  console.log(`[fhfa-pipeline] Fetching metro CSV (minYear=${minYear})...`);
  const byCbsa = await fetchFhfaMetroCsv(minYear);
  console.log(`  ${byCbsa.size} unique CBSAs/MSADs returned with rows >= ${minYear}`);

  const markets = await db
    .select({
      id: geographies.id,
      cbsaFips: geographies.cbsaFips,
      shortName: geographies.shortName,
      state: geographies.state,
    })
    .from(geographies)
    .where(eq(geographies.isActive, true));
  console.log(`  ${markets.length} active markets`);

  for (const m of markets) {
    result.marketsProcessed++;
    const lookupCbsa = FHFA_CBSA_OVERRIDE[m.cbsaFips] ?? m.cbsaFips;
    const rows = byCbsa.get(lookupCbsa);
    if (!rows || rows.length === 0) continue;

    // Sort by year, quarter so YoY computation is deterministic
    rows.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.quarter - b.quarter;
    });

    // Build a quick lookup for YoY
    const key = (y: number, q: number) => `${y}-${q}`;
    const hpiByPeriod = new Map<string, number>();
    for (const r of rows) hpiByPeriod.set(key(r.year, r.quarter), r.hpi);

    let marketRows = 0;
    for (const r of rows) {
      const priorHpi = hpiByPeriod.get(key(r.year - 1, r.quarter)) ?? null;
      const yoy = priorHpi != null && priorHpi > 0
        ? ((r.hpi - priorHpi) / priorHpi) * 100
        : null;
      try {
        await db
          .insert(fhfaHpi)
          .values({
            id: randomUUID(),
            geographyId: m.id,
            year: r.year,
            quarter: r.quarter,
            hpi: r.hpi.toFixed(2),
            hpiYoyChangePct: yoy != null ? yoy.toFixed(2) : null,
          })
          .onConflictDoUpdate({
            target: [fhfaHpi.geographyId, fhfaHpi.year, fhfaHpi.quarter],
            set: {
              hpi: r.hpi.toFixed(2),
              hpiYoyChangePct: yoy != null ? yoy.toFixed(2) : null,
              fetchedAt: new Date(),
            },
          });
        marketRows++;
        result.rowsInserted++;
      } catch (err) {
        result.errors.push(
          `${m.shortName} ${r.year}Q${r.quarter}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    if (marketRows > 0) result.marketsWithData++;
  }

  console.log(
    `[fhfa-pipeline] Done: ${result.marketsWithData}/${result.marketsProcessed} markets, ${result.rowsInserted} rows, ${result.errors.length} errors`
  );
  return result;
}
