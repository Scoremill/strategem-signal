/**
 * BLS QCEW (Quarterly Census of Employment and Wages) client.
 * Fetches trade construction employment and wages by NAICS 2381-2389
 * at MSA level for capacity analysis.
 *
 * API: https://data.bls.gov/cew/data/api/{year}/{qtr}/area/{area_code}.csv
 * No API key required. Rate limit: be polite (1 req/sec).
 * Data lag: 3-4 months after quarter-end.
 */

const BASE_URL = "https://data.bls.gov/cew/data/api";

// NAICS codes for construction specialty trades
const TRADE_NAICS = ["2381", "2382", "2383", "2389"];

const NAICS_DESCRIPTIONS: Record<string, string> = {
  "2381": "Foundation, Structure & Building Exterior",
  "2382": "Building Equipment Contractors (Electrical, Plumbing, HVAC)",
  "2383": "Building Finishing Contractors",
  "2389": "Other Specialty Trade Contractors",
};

// CBSA FIPS → QCEW area code mapping
// QCEW uses "C" + first 4 digits of CBSA FIPS
export function cbsaToQcewArea(cbsaFips: string): string {
  return `C${cbsaFips.slice(0, 4)}`;
}

// MSAs that require county-level aggregation because BLS suppresses
// MSA-level NAICS 238x data (typically due to union concentration or
// employer concentration). For these markets, we fetch each county
// individually and sum the results.
export const MSA_COUNTY_FALLBACK: Record<string, string[]> = {
  // Chicago-Naperville-Elgin, IL-IN-WI
  "16980": ["17031", "17043", "17089", "17093", "17111", "17197", "18089", "18127"],
  // Washington-Arlington-Alexandria, DC-VA-MD-WV
  "47900": ["11001", "24031", "24033", "51013", "51059", "51600", "51610", "51683", "51685", "51510"],
  // Portland-Vancouver-Hillsboro, OR-WA
  "38900": ["41005", "41009", "41051", "41067", "41071", "53011", "53059"],
  // Indianapolis-Carmel-Anderson, IN
  "26900": ["18011", "18013", "18057", "18059", "18063", "18081", "18097", "18109", "18145"],
  // Cincinnati, OH-KY-IN
  "17140": ["18029", "18115", "18161", "21015", "21023", "21037", "21077", "21081", "21117", "21191", "39015", "39017", "39025", "39061", "39165"],
  // Cleveland-Elyria, OH
  "17460": ["39035", "39055", "39085", "39093", "39103"],
  // Providence-Warwick, RI-MA
  "39300": ["44007", "44003", "44005", "44009", "44001", "25005"],
  // Provo-Orem-Lehi, UT
  "39340": ["49049", "49023"],
  // ─── 9-market expansion (April 2026): capacity county aggregation ───
  // Kansas City, MO-KS
  "28140": ["20091", "20103", "20107", "20121", "20209", "29013", "29025", "29037", "29047", "29049", "29095", "29107", "29165", "29177"],
  // Richmond, VA
  "40060": ["51007", "51036", "51041", "51053", "51075", "51085", "51087", "51127", "51145", "51149", "51183", "51570", "51670", "51730", "51760"],
  // Birmingham-Hoover, AL
  "13820": ["01007", "01009", "01073", "01115", "01117", "01127"],
  // Memphis, TN-MS-AR
  "32820": ["05035", "28033", "28093", "28137", "28143", "47047", "47157", "47167"],
  // Albuquerque, NM
  "10740": ["35001", "35043", "35057", "35061"],
  // Jackson, MS
  "27140": ["28029", "28049", "28051", "28089", "28121", "28127", "28163"],
};

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

export function stateToQcewArea(stateAbbr: string): string | null {
  const fips = STATE_FIPS[stateAbbr.toUpperCase()];
  return fips ? `${fips}000` : null;
}

export interface QcewTradeRecord {
  naicsCode: string;
  naicsDescription: string;
  avgMonthlyEmployment: number;
  totalQuarterlyWages: number;
  avgWeeklyWage: number;
  establishmentCount: number;
  wageYoyChangePct: number | null;
  employmentYoyChangePct: number | null;
}

/**
 * Fetch QCEW data for a specific MSA and quarter.
 * Filters to private ownership (own_code=5), NAICS 238x at 4-digit level.
 *
 * If the MSA is in MSA_COUNTY_FALLBACK, fetches each county individually
 * and aggregates the results instead of using the MSA-level code.
 */
export async function fetchQcewTrades(
  cbsaFips: string,
  year: number,
  quarter: number,
  stateAbbr?: string
): Promise<QcewTradeRecord[]> {
  // Use county aggregation for markets where BLS suppresses MSA-level data
  if (MSA_COUNTY_FALLBACK[cbsaFips]) {
    return fetchQcewTradesAggregated(cbsaFips, year, quarter);
  }

  const areaCode = cbsaToQcewArea(cbsaFips);
  const url = `${BASE_URL}/${year}/${quarter}/area/${areaCode}.csv`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      // MSA not available — try state-level fallback
      if (stateAbbr) return fetchQcewTradesState(stateAbbr, year, quarter);
      return [];
    }
    throw new Error(`QCEW API error ${res.status} for ${areaCode} ${year}Q${quarter}`);
  }

  const text = await res.text();
  const lines = text.split("\n");
  if (lines.length < 2) return [];

  // Parse CSV header
  const headers = parseCSVLine(lines[0]);
  const records: QcewTradeRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => (row[h] = values[idx] || ""));

    // Filter: private ownership (5), 4-digit NAICS 238x
    if (row.own_code !== "5") continue;
    const ic = row.industry_code;
    if (!TRADE_NAICS.includes(ic)) continue;

    const m1 = parseInt(row.month1_emplvl) || 0;
    const m2 = parseInt(row.month2_emplvl) || 0;
    const m3 = parseInt(row.month3_emplvl) || 0;
    const avgEmp = Math.round((m1 + m2 + m3) / 3);

    // Skip disclosure-suppressed records (all zeros)
    if (avgEmp === 0) continue;

    records.push({
      naicsCode: ic,
      naicsDescription: NAICS_DESCRIPTIONS[ic] || ic,
      avgMonthlyEmployment: avgEmp,
      totalQuarterlyWages: parseInt(row.total_qtrly_wages) || 0,
      avgWeeklyWage: parseInt(row.avg_wkly_wage) || 0,
      establishmentCount: parseInt(row.qtrly_estabs) || 0,
      wageYoyChangePct: row.oty_avg_wkly_wage_pct_chg
        ? parseFloat(row.oty_avg_wkly_wage_pct_chg)
        : null,
      employmentYoyChangePct: row.oty_month1_emplvl_pct_chg
        ? parseFloat(row.oty_month1_emplvl_pct_chg)
        : null,
    });
  }

  if (records.length === 0 && stateAbbr) {
    return fetchQcewTradesState(stateAbbr, year, quarter);
  }

  return records;
}

/**
 * Fetch state-level QCEW 238x data as a proxy for metros where BLS
 * suppresses MSA-level construction trade data. State-level data is
 * always published. Less precise than metro-level but better than
 * showing no operational score at all.
 */
async function fetchQcewTradesState(
  stateAbbr: string,
  year: number,
  quarter: number
): Promise<QcewTradeRecord[]> {
  const areaCode = stateToQcewArea(stateAbbr);
  if (!areaCode) return [];

  const url = `${BASE_URL}/${year}/${quarter}/area/${areaCode}.csv`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];

    const text = await res.text();
    const lines = text.split("\n");
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    const records: QcewTradeRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = parseCSVLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => (row[h] = values[idx] || ""));

      if (row.own_code !== "5") continue;
      const ic = row.industry_code;
      if (!TRADE_NAICS.includes(ic)) continue;

      const m1 = parseInt(row.month1_emplvl) || 0;
      const m2 = parseInt(row.month2_emplvl) || 0;
      const m3 = parseInt(row.month3_emplvl) || 0;
      const avgEmp = Math.round((m1 + m2 + m3) / 3);
      if (avgEmp === 0) continue;

      records.push({
        naicsCode: ic,
        naicsDescription: NAICS_DESCRIPTIONS[ic] || ic,
        avgMonthlyEmployment: avgEmp,
        totalQuarterlyWages: parseInt(row.total_qtrly_wages) || 0,
        avgWeeklyWage: parseInt(row.avg_wkly_wage) || 0,
        establishmentCount: parseInt(row.qtrly_estabs) || 0,
        wageYoyChangePct: row.oty_avg_wkly_wage_pct_chg
          ? parseFloat(row.oty_avg_wkly_wage_pct_chg)
          : null,
        employmentYoyChangePct: row.oty_month1_emplvl_pct_chg
          ? parseFloat(row.oty_month1_emplvl_pct_chg)
          : null,
      });
    }

    if (records.length > 0) {
      console.log(`  [qcew] State fallback ${stateAbbr}: ${records.length} trade sectors`);
    }

    return records;
  } catch {
    return [];
  }
}

/**
 * Fetch QCEW data for an MSA by aggregating its constituent counties.
 * Used for markets where MSA-level data is suppressed but county data is not.
 *
 * County FIPS is 5 digits (2-digit state + 3-digit county).
 * BLS QCEW county URL: /cew/data/api/{year}/{qtr}/area/{5-digit-fips}.csv
 */
async function fetchQcewTradesAggregated(
  cbsaFips: string,
  year: number,
  quarter: number
): Promise<QcewTradeRecord[]> {
  const counties = MSA_COUNTY_FALLBACK[cbsaFips];
  if (!counties) return [];

  // Accumulate totals per NAICS across all counties
  const totals: Record<string, {
    totalEmployment: number;
    totalWages: number;
    totalEstabs: number;
    wageSum: number;
    wageCount: number;
    wageYoySum: number;
    wageYoyCount: number;
    empYoySum: number;
    empYoyCount: number;
  }> = {};

  for (const naics of TRADE_NAICS) {
    totals[naics] = {
      totalEmployment: 0,
      totalWages: 0,
      totalEstabs: 0,
      wageSum: 0,
      wageCount: 0,
      wageYoySum: 0,
      wageYoyCount: 0,
      empYoySum: 0,
      empYoyCount: 0,
    };
  }

  for (const countyFips of counties) {
    // Small delay between counties to be polite to BLS
    await new Promise((r) => setTimeout(r, 300));

    const url = `${BASE_URL}/${year}/${quarter}/area/${countyFips}.csv`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;

      const text = await res.text();
      const lines = text.split("\n");
      if (lines.length < 2) continue;

      const headers = parseCSVLine(lines[0]);

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = parseCSVLine(lines[i]);
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => (row[h] = values[idx] || ""));

        if (row.own_code !== "5") continue;
        const ic = row.industry_code;
        if (!TRADE_NAICS.includes(ic)) continue;

        // Skip disclosure-suppressed rows
        if (row.disclosure_code === "N") continue;

        const m1 = parseInt(row.month1_emplvl) || 0;
        const m2 = parseInt(row.month2_emplvl) || 0;
        const m3 = parseInt(row.month3_emplvl) || 0;
        const avgEmp = Math.round((m1 + m2 + m3) / 3);
        if (avgEmp === 0) continue;

        const t = totals[ic];
        t.totalEmployment += avgEmp;
        t.totalWages += parseInt(row.total_qtrly_wages) || 0;
        t.totalEstabs += parseInt(row.qtrly_estabs) || 0;

        // Weighted average wage (by employment)
        const wkWage = parseInt(row.avg_wkly_wage) || 0;
        if (wkWage > 0) {
          t.wageSum += wkWage * avgEmp;
          t.wageCount += avgEmp;
        }

        // Simple average of YoY change rates (weighted by employment)
        if (row.oty_avg_wkly_wage_pct_chg) {
          const v = parseFloat(row.oty_avg_wkly_wage_pct_chg);
          if (!isNaN(v)) {
            t.wageYoySum += v * avgEmp;
            t.wageYoyCount += avgEmp;
          }
        }
        if (row.oty_month1_emplvl_pct_chg) {
          const v = parseFloat(row.oty_month1_emplvl_pct_chg);
          if (!isNaN(v)) {
            t.empYoySum += v * avgEmp;
            t.empYoyCount += avgEmp;
          }
        }
      }
    } catch (err) {
      console.warn(`[qcew] county fetch failed ${countyFips}:`, err);
    }
  }

  // Convert totals to QcewTradeRecord array
  const records: QcewTradeRecord[] = [];
  for (const naics of TRADE_NAICS) {
    const t = totals[naics];
    if (t.totalEmployment === 0) continue;

    records.push({
      naicsCode: naics,
      naicsDescription: NAICS_DESCRIPTIONS[naics] || naics,
      avgMonthlyEmployment: t.totalEmployment,
      totalQuarterlyWages: t.totalWages,
      avgWeeklyWage: t.wageCount > 0 ? Math.round(t.wageSum / t.wageCount) : 0,
      establishmentCount: t.totalEstabs,
      wageYoyChangePct: t.wageYoyCount > 0 ? Math.round((t.wageYoySum / t.wageYoyCount) * 10) / 10 : null,
      employmentYoyChangePct: t.empYoyCount > 0 ? Math.round((t.empYoySum / t.empYoyCount) * 10) / 10 : null,
    });
  }

  return records;
}

/**
 * Parse a CSV line handling quoted fields with commas.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Get the latest available QCEW quarter.
 *
 * BLS publishes QCEW ~5.5 months after each quarter-end (Q1 published mid-September,
 * Q2 mid-December, Q3 mid-March, Q4 mid-June). The 6-month lag heuristic is
 * pessimistic enough to avoid 404s right after a quarter ends but recent enough
 * to catch new releases the day after they publish.
 */
export function getLatestQcewQuarter(): { year: number; quarter: number } {
  const now = new Date();
  const lagDate = new Date(now);
  lagDate.setMonth(lagDate.getMonth() - 6);
  const year = lagDate.getFullYear();
  const quarter = Math.ceil((lagDate.getMonth() + 1) / 3);
  return { year, quarter };
}

/**
 * Probe BLS to find the most recent quarter that actually has published
 * data. Starts from the heuristic quarter and steps backward up to 4
 * quarters until it gets a 200 response with real data.
 */
export async function resolveAvailableQcewQuarter(): Promise<{ year: number; quarter: number }> {
  let { year: y, quarter: q } = getLatestQcewQuarter();
  for (let i = 0; i < 4; i++) {
    const url = `${BASE_URL}/${y}/${q}/area/C1910.csv`;
    try {
      const res = await fetch(url);
      if (res.ok) return { year: y, quarter: q };
    } catch { /* fall through */ }
    q--;
    if (q < 1) { q = 4; y--; }
  }
  return getLatestQcewQuarter();
}

/**
 * Get quarters for backfill (last 8 quarters = 2 years).
 */
export function getBackfillQuarters(): Array<{ year: number; quarter: number }> {
  const latest = getLatestQcewQuarter();
  const quarters: Array<{ year: number; quarter: number }> = [];

  let y = latest.year;
  let q = latest.quarter;

  for (let i = 0; i < 8; i++) {
    quarters.push({ year: y, quarter: q });
    q--;
    if (q < 1) {
      q = 4;
      y--;
    }
  }

  return quarters;
}
