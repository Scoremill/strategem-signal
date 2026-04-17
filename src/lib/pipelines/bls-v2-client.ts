/**
 * BLS Public Data API v2 client.
 *
 * Used for CES (employment by MSA) and LAUS (unemployment by MSA).
 * Requires BLS_API_KEY (free registration, 500 queries/day, 50 series/query).
 *
 * Docs: https://www.bls.gov/developers/api_signature_v2.htm
 */

const BASE_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

function getApiKey(): string {
  const key = process.env.BLS_API_KEY;
  if (!key) throw new Error("BLS_API_KEY not set");
  return key;
}

export interface BlsObservation {
  year: string;
  period: string; // "M01" through "M13" (M13 = annual avg)
  value: string;
  date: string; // Derived: "YYYY-MM-01"
}

interface BlsApiResponse {
  status: string;
  message: string[];
  Results: {
    series: Array<{
      seriesID: string;
      data: Array<{
        year: string;
        period: string;
        periodName: string;
        value: string;
        footnotes: Array<{ code: string; text: string }>;
      }>;
    }>;
  };
}

/**
 * Fetch one or more BLS series. Returns a map of seriesId → observations.
 * BLS v2 allows up to 50 series per request.
 */
export async function fetchBlsSeries(
  seriesIds: string[],
  startYear: number,
  endYear: number
): Promise<Map<string, BlsObservation[]>> {
  const result = new Map<string, BlsObservation[]>();
  if (seriesIds.length === 0) return result;

  // BLS allows 50 series per request; chunk if needed
  const chunks: string[][] = [];
  for (let i = 0; i < seriesIds.length; i += 50) {
    chunks.push(seriesIds.slice(i, i + 50));
  }

  for (const chunk of chunks) {
    const payload = {
      seriesid: chunk,
      startyear: String(startYear),
      endyear: String(endYear),
      registrationkey: getApiKey(),
    };

    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`BLS API error ${res.status}: ${await res.text()}`);
    }

    const data: BlsApiResponse = await res.json();
    if (data.status !== "REQUEST_SUCCEEDED") {
      throw new Error(`BLS API failed: ${data.message.join("; ")}`);
    }

    for (const series of data.Results.series) {
      const obs: BlsObservation[] = [];
      for (const d of series.data) {
        if (d.period === "M13") continue; // skip annual average
        const monthNum = parseInt(d.period.replace("M", ""), 10);
        if (monthNum < 1 || monthNum > 12) continue;
        const month = String(monthNum).padStart(2, "0");
        obs.push({
          year: d.year,
          period: d.period,
          value: d.value,
          date: `${d.year}-${month}-01`,
        });
      }
      // BLS returns newest first; reverse to chronological
      obs.sort((a, b) => a.date.localeCompare(b.date));
      result.set(series.seriesID, obs);
    }

    // Respect rate limits between chunks
    if (chunks.length > 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return result;
}

// ─── CES (Current Employment Statistics) ───────────────────────

/**
 * Build a CES series ID for total nonfarm employment at MSA level.
 *
 * Format: SMS{stateFips}{cbsaFips}00000000{dataType}
 *   - SMS = State/Metro/Size class
 *   - stateFips = 2-digit state FIPS
 *   - cbsaFips = 5-digit CBSA code
 *   - 00000000 = total nonfarm (all industries)
 *   - dataType = 01 (all employees, thousands)
 */
export function cesSeriesId(stateFips: string, cbsaFips: string): string {
  return `SMS${stateFips}${cbsaFips}0000000001`;
}

// ─── LAUS (Local Area Unemployment Statistics) ──────────────────

/**
 * Build a LAUS series ID for unemployment rate at MSA level.
 *
 * Format: LAUMT{stateFips}{areaCode}0000000{measureCode}
 *   - LAUMT = Local Area Unemployment, Metro Type
 *   - stateFips = 2-digit state FIPS
 *   - areaCode = first 4 digits of CBSA FIPS (same as QCEW area)
 *   - 0000000 = 7-zero padding
 *   - measureCode = 03 (unemployment rate, 2 digits)
 */
export function lausSeriesId(stateFips: string, cbsaFips: string): string {
  return `LAUMT${stateFips}${cbsaFips.slice(0, 4)}000000003`;
}

// ─── State FIPS lookup ──────────────────────────────────────────

const STATE_ABBR_TO_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09",
  DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17",
  IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24",
  MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31",
  NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38",
  OH: "39", OK: "40", OR: "41", PA: "42", PR: "72", RI: "44", SC: "45",
  SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53",
  WV: "54", WI: "55", WY: "56",
};

export function stateAbbrToFips(abbr: string): string | null {
  return STATE_ABBR_TO_FIPS[abbr.toUpperCase()] ?? null;
}
