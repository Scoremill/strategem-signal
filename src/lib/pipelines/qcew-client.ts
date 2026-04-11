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
 */
export async function fetchQcewTrades(
  cbsaFips: string,
  year: number,
  quarter: number
): Promise<QcewTradeRecord[]> {
  const areaCode = cbsaToQcewArea(cbsaFips);
  const url = `${BASE_URL}/${year}/${quarter}/area/${areaCode}.csv`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return []; // Quarter not yet available
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
 * Get the latest available QCEW quarter (3-4 month lag).
 */
export function getLatestQcewQuarter(): { year: number; quarter: number } {
  const now = new Date();
  // QCEW has ~4 month lag. Current month minus 4, then find the quarter.
  const lagDate = new Date(now);
  lagDate.setMonth(lagDate.getMonth() - 4);
  const year = lagDate.getFullYear();
  const quarter = Math.ceil((lagDate.getMonth() + 1) / 3);
  return { year, quarter };
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
