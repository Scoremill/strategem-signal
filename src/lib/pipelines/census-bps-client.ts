/**
 * Census Bureau Building Permits Survey (BPS) client.
 *
 * Source: https://www.census.gov/construction/bps/msamonthly.html
 * Format: monthly .xls files keyed by CBSA, one file per month.
 * File URL pattern:
 *   https://www.census.gov/construction/bps/xls/cbsamonthly_YYYYMM.xls
 *
 * Coverage: all ~384 US Metropolitan Statistical Areas, no gaps.
 * Freshness: ~5-6 week lag from month-end. First release is
 * preliminary; Census revises the following month.
 *
 * Replaces FRED as StrategemSignal's permit data source as of
 * 2026-04-14. FRED is missing recent updates and only covers ~60
 * major metros; Census BPS has full coverage and is the upstream
 * source that FRED re-hosts.
 */
import * as XLSX from "xlsx";

const BPS_URL_BASE = "https://www.census.gov/construction/bps/xls";

export interface BpsPermitRow {
  cbsaFips: string;
  metroName: string;
  /** Total units authorized that month (all structure types). */
  totalUnits: number;
  /** 1-unit (single family) detached permits that month. */
  singleFamily: number;
  /** 2-unit through 5+ unit permits combined. */
  multiFamily: number;
  numReportingAreas: number;
}

/**
 * Download and parse one month of Census BPS MSA data.
 * Returns all ~384 metros' permit counts for that month.
 *
 * Returns null if the file doesn't exist yet (Census hasn't published
 * the month) — the caller should treat that as "skip this period" not
 * as an error.
 *
 * Census renamed both the file prefix and the sheet name sometime in
 * early 2024:
 *   2023 and earlier: msamonthly_YYYYMM.xls with sheet "MSA Units"
 *   2024 and later:   cbsamonthly_YYYYMM.xls with sheet "CBSA Units"
 * We try the new naming first, fall back to the old if that 404s.
 */
export async function fetchBpsMonth(
  year: number,
  month: number
): Promise<BpsPermitRow[] | null> {
  const ym = `${year}${String(month).padStart(2, "0")}`;

  // Try the post-2024 naming first
  let url = `${BPS_URL_BASE}/cbsamonthly_${ym}.xls`;
  let res = await fetch(url);
  if (res.status === 404) {
    // Fall back to the pre-2024 naming
    url = `${BPS_URL_BASE}/msamonthly_${ym}.xls`;
    res = await fetch(url);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Census BPS ${ym} HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    // Census sometimes returns a 200-status HTML 404 page for missing
    // months. Treat as not-yet-published.
    return null;
  }

  const buf = await res.arrayBuffer();
  const wb = XLSX.read(buf, { type: "buffer" });

  // Sheet name changed from "MSA Units" to "CBSA Units" in the 2024
  // redesign. Accept either; the column layout is identical.
  const sheet = wb.Sheets["CBSA Units"] ?? wb.Sheets["MSA Units"];
  if (!sheet) {
    throw new Error(
      `Census BPS ${ym}: neither CBSA Units nor MSA Units sheet found (have ${wb.SheetNames.join(", ")})`
    );
  }

  // Parse as 2D array so we can skip the 3-row header prelude.
  const grid = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const out: BpsPermitRow[] = [];
  for (const row of grid) {
    if (!row || row.length < 9) continue;
    const cbsa = row[1];
    const name = row[2];
    // Rows with a numeric CBSA and a metro name are real data rows.
    // Header, sub-header, and footer rows have nulls in these slots.
    if (typeof cbsa !== "number" && typeof cbsa !== "string") continue;
    if (typeof name !== "string") continue;

    const cbsaStr = String(cbsa).padStart(5, "0");
    // Skip rows that aren't 5-digit CBSA FIPS (e.g. totals, sub-headers)
    if (!/^\d{5}$/.test(cbsaStr)) continue;

    const total = toInt(row[4]);
    const sf = toInt(row[5]);
    const u2 = toInt(row[6]);
    const u34 = toInt(row[7]);
    const u5p = toInt(row[8]);
    if (total == null || sf == null) continue;

    const mf = (u2 ?? 0) + (u34 ?? 0) + (u5p ?? 0);
    out.push({
      cbsaFips: cbsaStr,
      metroName: name.trim(),
      totalUnits: total,
      singleFamily: sf,
      multiFamily: mf,
      numReportingAreas: toInt(row[3]) ?? 0,
    });
  }
  return out;
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Generate a list of { year, month } tuples covering a date range.
 * start and end are inclusive.
 */
export function monthRange(
  start: { year: number; month: number },
  end: { year: number; month: number }
): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  let y = start.year;
  let m = start.month;
  while (y < end.year || (y === end.year && m <= end.month)) {
    out.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Returns the current "latest likely published" month — approximately
 * 6 weeks before today. Census BPS publishes with a ~5-6 week lag, so
 * on April 14 we expect February data to be live.
 */
export function getLatestBpsMonth(): { year: number; month: number } {
  const now = new Date();
  now.setDate(now.getDate() - 45);
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}
