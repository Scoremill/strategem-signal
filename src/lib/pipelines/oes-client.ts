/**
 * BLS OEWS (Occupational Employment and Wage Statistics) client.
 *
 * Series ID format (25 chars):
 *   OE + U + M + <7 area> + <6 industry> + <6 occupation> + <2 datatype>
 *
 *   Area code:    "00" + 4-digit CBSA + "00"   (e.g., Dallas 19100 → "0019100")
 *   Industry:     "000000" for all industries (cross-industry estimates)
 *   Occupation:   SOC code with hyphen removed, no trailing zeros (e.g., "47-2031" → "472031")
 *   Datatype:     "01" employment, "04" annual mean wage, "13" annual median wage
 *
 * Annual data published once per year (April/May for prior year).
 * BLS Public Data API v2: https://api.bls.gov/publicAPI/v2/timeseries/data/
 * Up to 50 series per request without key, 500 with registered key.
 */

const BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

/**
 * Construction trade occupations (SOC 47-xxxx) most relevant to homebuilding.
 * Curated subset — full SOC 47 has 60+ codes; these are the ones builders
 * actually negotiate trade contracts for.
 */
export const TRADE_OCCUPATIONS: Array<{ socCode: string; title: string; category: string }> = [
  // First-line supervisors
  { socCode: "47-1011", title: "First-Line Supervisors of Construction Trades",          category: "Supervision" },

  // Structural / framing / concrete
  { socCode: "47-2031", title: "Carpenters",                                              category: "Framing" },
  { socCode: "47-2061", title: "Construction Laborers",                                   category: "General Labor" },
  { socCode: "47-2051", title: "Cement Masons & Concrete Finishers",                      category: "Concrete" },
  { socCode: "47-2073", title: "Operating Engineers & Other Construction Equipment Operators", category: "Site Work" },
  { socCode: "47-2211", title: "Sheet Metal Workers",                                     category: "Metal Work" },

  // Masonry & exterior
  { socCode: "47-2021", title: "Brickmasons & Blockmasons",                               category: "Masonry" },
  { socCode: "47-2181", title: "Roofers",                                                 category: "Exterior" },
  { socCode: "47-2161", title: "Plasterers & Stucco Masons",                              category: "Exterior" },

  // MEP — mechanical, electrical, plumbing
  { socCode: "47-2111", title: "Electricians",                                            category: "Electrical" },
  { socCode: "47-2152", title: "Plumbers, Pipefitters & Steamfitters",                    category: "Plumbing" },
  { socCode: "49-9021", title: "Heating, AC & Refrigeration Mechanics",                   category: "HVAC" },

  // Finishing
  { socCode: "47-2081", title: "Drywall & Ceiling Tile Installers",                       category: "Finishing" },
  { socCode: "47-2141", title: "Painters, Construction & Maintenance",                    category: "Finishing" },
  { socCode: "47-2042", title: "Floor Layers (except Carpet, Wood, Hard Tiles)",          category: "Finishing" },
  { socCode: "47-2044", title: "Tile & Stone Setters",                                    category: "Finishing" },
  { socCode: "47-2121", title: "Glaziers",                                                category: "Finishing" },
  { socCode: "47-2071", title: "Paving, Surfacing & Tamping Equipment Operators",         category: "Site Work" },
];

const DATATYPE_EMPLOYMENT     = "01";
const DATATYPE_HOURLY_MEAN    = "03";
const DATATYPE_ANNUAL_MEAN    = "04";
const DATATYPE_ANNUAL_MEDIAN  = "13";

/**
 * Build a 25-char OEWS series ID.
 */
export function buildOewsSeriesId(
  cbsaFips: string,
  socCode: string,
  datatype: string
): string {
  // Area: pad CBSA to 4 digits, prefix with "00", suffix with "00" → 7 chars total.
  // BLS uses "0019100" = 00 + 19100 + 00 = 9 digits. Wait, 00 + 19100 = 0019100 (7 chars).
  // The CBSA fips is 5 digits but only first 4 are used, then 3 trailing zeros.
  // Actually verified: "0019100" works for Dallas 19100.
  const area = `00${cbsaFips}`.slice(-7);
  const occ  = socCode.replace("-", "");
  return `OEUM${area}000000${occ}${datatype}`;
}

interface BlsApiObservation {
  year: string;
  period: string;
  value: string;
}

interface BlsApiSeriesResponse {
  seriesID: string;
  data: BlsApiObservation[];
}

interface BlsApiResponse {
  status: string;
  message?: string[];
  Results: { series: BlsApiSeriesResponse[] };
}

/**
 * Fetch a batch of OEWS series. Up to 50 series per request without API key.
 * Returns a map of seriesId → most-recent annual value (parsed as number),
 * or null if missing/suppressed.
 */
export async function fetchOewsBatch(
  seriesIds: string[],
  startYear: number,
  endYear: number,
  apiKey?: string
): Promise<Map<string, Map<number, number>>> {
  const result = new Map<string, Map<number, number>>();
  if (!seriesIds.length) return result;

  // BLS API limit: 50 series/request without key, 500 with.
  const batchSize = 50;
  for (let i = 0; i < seriesIds.length; i += batchSize) {
    const batch = seriesIds.slice(i, i + batchSize);
    const body: Record<string, unknown> = {
      seriesid: batch,
      startyear: String(startYear),
      endyear: String(endYear),
    };
    if (apiKey) body.registrationkey = apiKey;

    const res = await fetch(BLS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`BLS OEWS API HTTP ${res.status}: ${await res.text()}`);
    }

    const data: BlsApiResponse = await res.json();
    if (data.status !== "REQUEST_SUCCEEDED") {
      throw new Error(`BLS OEWS API status ${data.status}: ${data.message?.join("; ")}`);
    }

    for (const series of data.Results.series) {
      const yearMap = new Map<number, number>();
      for (const obs of series.data) {
        if (obs.period !== "A01") continue; // annual averages only
        const v = parseFloat(obs.value);
        if (!Number.isFinite(v)) continue;
        yearMap.set(parseInt(obs.year, 10), v);
      }
      if (yearMap.size > 0) result.set(series.seriesID, yearMap);
    }

    // Rate limit pause
    await new Promise((r) => setTimeout(r, 800));
  }

  return result;
}

export const OES_DATATYPES = {
  EMPLOYMENT: DATATYPE_EMPLOYMENT,
  HOURLY_MEAN: DATATYPE_HOURLY_MEAN,
  ANNUAL_MEAN: DATATYPE_ANNUAL_MEAN,
  ANNUAL_MEDIAN: DATATYPE_ANNUAL_MEDIAN,
} as const;
