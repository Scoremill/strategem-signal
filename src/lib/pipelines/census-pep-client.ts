/**
 * Census Population Estimates Program (PEP) client.
 *
 * Downloads the annual MSA-level population estimates CSV directly
 * from Census Bureau servers. This is the upstream source that FRED
 * re-hosts — we cut out the middleman for full MSA coverage.
 *
 * Source: https://www2.census.gov/programs-surveys/popest/datasets/
 * Format: One CSV per vintage covering all ~380 CBSAs with 5 years
 *   of annual population, births, deaths, and migration components.
 * Frequency: Annual. New vintage published December-March.
 * Coverage: All Metropolitan and Micropolitan Statistical Areas.
 */

const PEP_BASE = "https://www2.census.gov/programs-surveys/popest/datasets";

export interface PepRow {
  cbsaFips: string;
  name: string;
  year: number;
  population: number;
  netDomesticMigration: number;
  netInternationalMigration: number;
}

/**
 * Download and parse the Census PEP metro totals CSV for a given
 * vintage (e.g., 2024 = the 2020-2024 estimates file). Returns
 * rows for all CBSAs across all years in the vintage.
 */
export async function fetchPepVintage(vintage: number): Promise<PepRow[]> {
  const startDecade = Math.floor(vintage / 10) * 10;
  const url = `${PEP_BASE}/${startDecade}-${vintage}/metro/totals/cbsa-est${vintage}-alldata.csv`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Census PEP ${vintage} HTTP ${res.status}`);
  }

  const text = await res.text();
  const lines = text.split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());

  // Find column indices for the fields we need
  const cbsaIdx = headers.indexOf("CBSA");
  const nameIdx = headers.indexOf("NAME");
  const lsadIdx = headers.indexOf("LSAD");
  const stcouIdx = headers.indexOf("STCOU");

  if (cbsaIdx === -1 || nameIdx === -1) {
    throw new Error(`Census PEP ${vintage}: missing CBSA or NAME column`);
  }

  // Build year column indices dynamically
  const yearCols: Array<{
    year: number;
    popIdx: number;
    domMigIdx: number;
    intMigIdx: number;
  }> = [];

  for (let y = startDecade; y <= vintage; y++) {
    const popIdx = headers.indexOf(`POPESTIMATE${y}`);
    const domMigIdx = headers.indexOf(`DOMESTICMIG${y}`);
    const intMigIdx = headers.indexOf(`INTERNATIONALMIG${y}`);
    if (popIdx !== -1) {
      yearCols.push({ year: y, popIdx, domMigIdx, intMigIdx });
    }
  }

  const rows: PepRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);

    // Only include CBSA-level rows (not county subdivisions).
    // CBSA-level rows have an empty STCOU field.
    if (stcouIdx !== -1 && values[stcouIdx]?.trim()) continue;

    // Only include Metropolitan Statistical Areas
    if (lsadIdx !== -1 && !values[lsadIdx]?.includes("Metropolitan")) continue;

    const cbsa = values[cbsaIdx]?.trim();
    const name = values[nameIdx]?.trim().replace(/"/g, "");
    if (!cbsa || !/^\d{5}$/.test(cbsa)) continue;

    for (const yc of yearCols) {
      const pop = parseInt(values[yc.popIdx] || "0", 10);
      if (!pop || pop <= 0) continue;

      const domMig = yc.domMigIdx !== -1
        ? parseInt(values[yc.domMigIdx] || "0", 10)
        : 0;
      const intMig = yc.intMigIdx !== -1
        ? parseInt(values[yc.intMigIdx] || "0", 10)
        : 0;

      rows.push({
        cbsaFips: cbsa,
        name: name.replace(/, (Metropolitan|Micropolitan) Statistical Area$/, ""),
        year: yc.year,
        population: pop,
        netDomesticMigration: domMig,
        netInternationalMigration: intMig,
      });
    }
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
