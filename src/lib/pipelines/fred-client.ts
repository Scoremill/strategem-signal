/**
 * FRED (Federal Reserve Economic Data) API client.
 * Used for building permits, employment, unemployment, and population data at MSA level.
 *
 * API docs: https://fred.stlouisfed.org/docs/api/fred/
 * Rate limit: 120 requests/minute with API key
 */

const BASE_URL = "https://api.stlouisfed.org/fred";

function getApiKey(): string {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error("FRED_API_KEY not set");
  return key;
}

export interface FredObservation {
  date: string; // "YYYY-MM-DD"
  value: string; // numeric string or "."
}

interface FredObservationsResponse {
  observations: FredObservation[];
}

interface FredSeriesSearchResponse {
  seriess: Array<{
    id: string;
    title: string;
    frequency: string;
  }>;
}

/**
 * Fetch observations for a FRED series.
 */
export async function fetchSeries(
  seriesId: string,
  options?: {
    startDate?: string; // "YYYY-MM-DD"
    endDate?: string;
    limit?: number;
    sortOrder?: "asc" | "desc";
  }
): Promise<FredObservation[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: getApiKey(),
    file_type: "json",
  });

  if (options?.startDate) params.set("observation_start", options.startDate);
  if (options?.endDate) params.set("observation_end", options.endDate);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.sortOrder) params.set("sort_order", options.sortOrder);

  const url = `${BASE_URL}/series/observations?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`FRED API error ${res.status}: ${await res.text()}`);
  }

  const data: FredObservationsResponse = await res.json();
  // Filter out missing values (".")
  return data.observations.filter((o) => o.value !== ".");
}

/**
 * Fetch and sum annual permit counts across a list of county FIPS codes.
 * Used for MSAs without MSA-level permit series (Cleveland, Providence, Provo).
 *
 * Returns a pseudo-monthly series by dividing annual totals by 12.
 * This is an approximation but works for scoring since we compare ratios
 * and YoY rates across markets.
 */
export async function fetchAggregatedCountyPermits(
  countyFipsList: string[],
  startDate: string
): Promise<FredObservation[]> {
  // Build a date → total map
  const totals = new Map<string, number>();

  for (const fips of countyFipsList) {
    await new Promise((r) => setTimeout(r, 600)); // rate limit
    try {
      const obs = await fetchSeries(`BPPRIV${fips}`, { startDate });
      for (const o of obs) {
        const v = parseFloat(o.value);
        if (isNaN(v)) continue;
        totals.set(o.date, (totals.get(o.date) || 0) + v);
      }
    } catch (err) {
      console.warn(`[fred] county permit fetch failed ${fips}:`, err);
    }
  }

  // Convert annual to pseudo-monthly (divide by 12) for consistency with
  // other MSAs' monthly permit data. Emit as 12 monthly observations
  // per annual value so trend calculations work.
  const result: FredObservation[] = [];
  const sortedDates = [...totals.keys()].sort();
  for (const yearDate of sortedDates) {
    const annualTotal = totals.get(yearDate)!;
    const monthlyAvg = annualTotal / 12;
    // The annual FRED observation is labeled with YYYY-01-01, representing
    // the full year. Emit it as a single monthly average record.
    result.push({
      date: yearDate,
      value: String(Math.round(monthlyAvg)),
    });
  }

  return result;
}

/**
 * Search for FRED series by keyword.
 */
export async function searchSeries(
  query: string,
  limit = 5
): Promise<FredSeriesSearchResponse["seriess"]> {
  const params = new URLSearchParams({
    search_text: query,
    api_key: getApiKey(),
    file_type: "json",
    limit: String(limit),
  });

  const url = `${BASE_URL}/series/search?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`FRED search error ${res.status}: ${await res.text()}`);
  }

  const data: FredSeriesSearchResponse = await res.json();
  return data.seriess;
}

/**
 * FRED series ID mappings for our 15 MVP MSAs.
 *
 * Pattern for permits: {CITY_ABBR}{OLD_FIPS}BPPRIVSA (total, seasonally adjusted)
 * Pattern for SF permits: {CITY_ABBR}{OLD_FIPS}BP1FHSA (single family, SA)
 * Pattern for employment: {CITY_ABBR}{OLD_FIPS}NA (nonfarm, SA)
 * Pattern for unemployment: {CITY_ABBR}{OLD_FIPS}URN (unemployment rate, NSA)
 * Pattern for population: {CITY_ABBR}POP (annual, resident population)
 */
export const MSA_SERIES: Record<
  string,
  {
    totalPermits: string;
    singleFamilyPermits: string;
    nonfarmEmployment: string;
    unemploymentRate: string;
    population: string;
  }
> = {
  "19100": {
    // Dallas-Fort Worth
    totalPermits: "DALL148BPPRIVSA",
    singleFamilyPermits: "DALL148BP1FHSA",
    nonfarmEmployment: "DALL148NA",
    unemploymentRate: "DALL148URN",
    population: "DFWPOP",
  },
  "26420": {
    // Houston
    totalPermits: "HOUS448BPPRIVSA",
    singleFamilyPermits: "HOUS448BP1FHSA",
    nonfarmEmployment: "HOUS448NA",
    unemploymentRate: "HOUS448URN",
    population: "HTNPOP",
  },
  "12420": {
    // Austin
    totalPermits: "AUST448BPPRIVSA",
    singleFamilyPermits: "AUST448BP1FHSA",
    nonfarmEmployment: "AUST448NA",
    unemploymentRate: "AUST448URN",
    population: "AUSPOP",
  },
  "41700": {
    // San Antonio
    totalPermits: "SANA748BPPRIVSA",
    singleFamilyPermits: "SANA748BP1FHSA",
    nonfarmEmployment: "SANA748NA",
    unemploymentRate: "SANA748URN",
    population: "SATPOP",
  },
  "38060": {
    // Phoenix
    totalPermits: "PHOE004BPPRIVSA",
    singleFamilyPermits: "PHOE004BP1FHSA",
    nonfarmEmployment: "PHOE004NA",
    unemploymentRate: "PHOE004URN",
    population: "PHXPOP",
  },
  "29820": {
    // Las Vegas
    totalPermits: "LASV832BPPRIVSA",
    singleFamilyPermits: "LASV832BP1FHSA",
    nonfarmEmployment: "LASV832NA",
    unemploymentRate: "LASV832URN",
    population: "LSVPOP",
  },
  "12060": {
    // Atlanta
    totalPermits: "ATLA013BPPRIVSA",
    singleFamilyPermits: "ATLA013BP1FHSA",
    nonfarmEmployment: "ATLA013NA",
    unemploymentRate: "ATLA013URN",
    population: "ATLPOP",
  },
  "16740": {
    // Charlotte
    totalPermits: "CHAR737BPPRIVSA",
    singleFamilyPermits: "CHAR737BP1FHSA",
    nonfarmEmployment: "CHAR737NA",
    unemploymentRate: "CHAR737URN",
    population: "CGRPOP",
  },
  "39580": {
    // Raleigh
    totalPermits: "RALE537BPPRIVSA",
    singleFamilyPermits: "RALE537BP1FHSA",
    nonfarmEmployment: "RALE537NA",
    unemploymentRate: "RALE537URN",
    population: "RCYPOP",
  },
  "34980": {
    // Nashville
    totalPermits: "NASH947BPPRIVSA",
    singleFamilyPermits: "NASH947BP1FHSA",
    nonfarmEmployment: "NASH947NA",
    unemploymentRate: "NASH947URN",
    population: "NVLPOP",
  },
  "45300": {
    // Tampa
    totalPermits: "TAMP312BPPRIVSA",
    singleFamilyPermits: "TAMP312BP1FHSA",
    nonfarmEmployment: "TAMP312NA",
    unemploymentRate: "TAMP312URN",
    population: "TMAPOP",
  },
  "36740": {
    // Orlando
    totalPermits: "ORLA712BPPRIVSA",
    singleFamilyPermits: "ORLA712BP1FHSA",
    nonfarmEmployment: "ORLA712NA",
    unemploymentRate: "ORLA712URN",
    population: "ORLPOP",
  },
  "27260": {
    // Jacksonville
    totalPermits: "JACK212BPPRIVSA",
    singleFamilyPermits: "JACK212BP1FHSA",
    nonfarmEmployment: "JACK212NA",
    unemploymentRate: "JACK212URN",
    population: "JAXPOP",
  },
  "19740": {
    // Denver
    totalPermits: "DENV708BPPRIVSA",
    singleFamilyPermits: "DENV708BP1FHSA",
    nonfarmEmployment: "DENV708NA",
    unemploymentRate: "DENV708URN",
    population: "DNVPOP",
  },
  "14260": {
    // Boise
    totalPermits: "BOIS216BPPRIVSA",
    singleFamilyPermits: "BOIS216BP1FHSA",
    nonfarmEmployment: "BOIS216NA",
    unemploymentRate: "BOIS216URN",
    population: "BOIPOP",
  },
  // ─── New markets added 2026-04 ─────────────────────────────────
  "35620": {
    // New York-Newark-Jersey City
    totalPermits: "NEWY636BPPRIVSA",
    singleFamilyPermits: "NEWY636BP1FHSA",
    nonfarmEmployment: "NEWY636NA",
    unemploymentRate: "NEWY636URN",
    population: "NYTPOP",
  },
  "31080": {
    // Los Angeles-Long Beach-Anaheim
    totalPermits: "LOSA106BPPRIVSA",
    singleFamilyPermits: "LOSA106BP1FHSA",
    nonfarmEmployment: "SMS06310800000000001",
    unemploymentRate: "LOSA106URN",
    population: "LNAPOP",
  },
  "37980": {
    // Philadelphia-Camden-Wilmington
    totalPermits: "PHIL942BPPRIVSA",
    singleFamilyPermits: "PHIL942BP1FHSA",
    nonfarmEmployment: "PHIL942NA",
    unemploymentRate: "PHIL942URN",
    population: "PCWPOP",
  },
  "33100": {
    // Miami-Fort Lauderdale-Pompano Beach
    totalPermits: "MIAM112BPPRIVSA",
    singleFamilyPermits: "MIAM112BP1FHSA",
    nonfarmEmployment: "MIAM112NA",
    unemploymentRate: "MIAM112URN",
    population: "MIMPOP",
  },
  "14460": {
    // Boston-Cambridge-Newton
    totalPermits: "BOST625BPPRIVSA",
    singleFamilyPermits: "BOST625BP1FHSA",
    nonfarmEmployment: "BOST625NA",
    unemploymentRate: "BOST625URN",
    population: "BOSPOP",
  },
  "19820": {
    // Detroit-Warren-Dearborn
    totalPermits: "DETR826BPPRIVSA",
    singleFamilyPermits: "DETR826BP1FHSA",
    nonfarmEmployment: "DETR826NA",
    unemploymentRate: "DETR826URN",
    population: "DWLPOP",
  },
  "41860": {
    // San Francisco-Oakland-Berkeley
    totalPermits: "SANF806BPPRIVSA",
    singleFamilyPermits: "SANF806BP1FHSA",
    nonfarmEmployment: "SANF806NA",
    unemploymentRate: "SANF806URN",
    population: "SFCPOP",
  },
  "42660": {
    // Seattle-Tacoma-Bellevue
    totalPermits: "SEAT653BPPRIVSA",
    singleFamilyPermits: "SEAT653BP1FHSA",
    nonfarmEmployment: "SEAT653NA",
    unemploymentRate: "SEAT653URN",
    population: "STWPOP",
  },
  "33460": {
    // Minneapolis-St. Paul-Bloomington
    totalPermits: "MINN427BPPRIVSA",
    singleFamilyPermits: "MINN427BP1FHSA",
    nonfarmEmployment: "MINN427NA",
    unemploymentRate: "MINN427URN",
    population: "MSPPOP",
  },
  "41740": {
    // San Diego-Chula Vista-Carlsbad
    totalPermits: "SAND706BPPRIVSA",
    singleFamilyPermits: "SAND706BP1FHSA",
    nonfarmEmployment: "SAND706NA",
    unemploymentRate: "SAND706URN",
    population: "SDIPOP",
  },
  "45060": {
    // Sacramento-Roseville-Folsom
    totalPermits: "SACR906BPPRIVSA",
    singleFamilyPermits: "SACR906BP1FHSA",
    nonfarmEmployment: "SACR906NA",
    unemploymentRate: "SACR906URN",
    population: "SYOPOP",
  },
  "40140": {
    // Riverside-San Bernardino-Ontario
    totalPermits: "RIVE106BPPRIVSA",
    singleFamilyPermits: "RIVE106BP1FHSA",
    nonfarmEmployment: "RIVE106NA",
    unemploymentRate: "RIVE106URN",
    population: "RSBPOP",
  },
  "12580": {
    // Baltimore-Columbia-Towson
    totalPermits: "BALT524BPPRIVSA",
    singleFamilyPermits: "BALT524BP1FHSA",
    nonfarmEmployment: "BALT524NA",
    unemploymentRate: "BALT524URN",
    population: "BTMPOP",
  },
  "18140": {
    // Columbus, OH
    totalPermits: "COLU139BPPRIVSA",
    singleFamilyPermits: "COLU139BP1FHSA",
    nonfarmEmployment: "COLU139NA",
    unemploymentRate: "COLU139URN",
    population: "COLPOP",
  },
  "31140": {
    // Louisville/Jefferson County
    totalPermits: "LOIBPPRIVSA",
    singleFamilyPermits: "LOIBP1FHSA",
    nonfarmEmployment: "LOINA",
    unemploymentRate: "LOIURN",
    population: "LOIPOP",
  },
  "33340": {
    // Milwaukee-Waukesha
    totalPermits: "MILW355BPPRIVSA",
    singleFamilyPermits: "MILW355BP1FHSA",
    nonfarmEmployment: "MILW355NA",
    unemploymentRate: "MILW355URN",
    population: "MWKPOP",
  },
  "41620": {
    // Salt Lake City
    totalPermits: "SALT649BPPRIVSA",
    singleFamilyPermits: "SALT649BP1FHSA",
    nonfarmEmployment: "SALT649NA",
    unemploymentRate: "SALT649URN",
    population: "SLCPOP",
  },
  "16700": {
    // Charleston-North Charleston
    totalPermits: "CHAR745BPPRIVSA",
    singleFamilyPermits: "CHAR745BP1FHSA",
    nonfarmEmployment: "CHAR745NA",
    unemploymentRate: "CHAR745URN",
    population: "CRLPOP",
  },
  "15980": {
    // Cape Coral-Fort Myers
    totalPermits: "CAPE912BPPRIVSA",
    singleFamilyPermits: "CAPE912BP1FHSA",
    nonfarmEmployment: "CAPE912NA",
    unemploymentRate: "CAPE912URN",
    population: "FTMPOP",
  },
  "34820": {
    // Myrtle Beach-Conway-North Myrtle Beach
    totalPermits: "MYRT845BPPRIVSA",
    singleFamilyPermits: "MYRT845BP1FHSA",
    nonfarmEmployment: "MYRT845NA",
    unemploymentRate: "MYRT845URN",
    population: "MYRPOP",
  },
  // ─── Markets with MSA-level FRED data (added via county-agg for capacity) ───
  "16980": {
    // Chicago-Naperville-Elgin
    totalPermits: "CHIC917BPPRIVSA",
    singleFamilyPermits: "CHIC917BP1FHSA",
    nonfarmEmployment: "CHIC917NA",
    unemploymentRate: "CHIC917URN",
    population: "CHIPOP",
  },
  "47900": {
    // Washington-Arlington-Alexandria
    totalPermits: "WASH911BPPRIVSA",
    singleFamilyPermits: "WASH911BP1FHSA",
    nonfarmEmployment: "WASH911NA",
    unemploymentRate: "WASH911URN",
    population: "WSHPOP",
  },
  "38900": {
    // Portland-Vancouver-Hillsboro
    totalPermits: "PORT941BPPRIVSA",
    singleFamilyPermits: "PORT941BP1FHSA",
    nonfarmEmployment: "PORT941NA",
    unemploymentRate: "PORT941URN",
    population: "PORPOP",
  },
  "26900": {
    // Indianapolis-Carmel-Anderson
    totalPermits: "INDI918BPPRIVSA",
    singleFamilyPermits: "INDI918BP1FHSA",
    nonfarmEmployment: "INDI918NA",
    unemploymentRate: "INDI918URN",
    population: "INDPOP",
  },
  "17140": {
    // Cincinnati
    totalPermits: "CINC139BPPRIVSA",
    singleFamilyPermits: "CINC139BP1FHSA",
    nonfarmEmployment: "CINC139NA",
    unemploymentRate: "CINC139URN",
    population: "CTIPOP",
  },
  // ─── 9-market expansion (April 2026): Tier 1 + Tier 2 ─────────────
  "38300": {
    // Pittsburgh, PA
    totalPermits: "PITT342BPPRIVSA",
    singleFamilyPermits: "PITT342BP1FHSA",
    nonfarmEmployment: "PITT342NA",
    unemploymentRate: "PITT342URN",
    population: "PITPOP",
  },
  "46060": {
    // Tucson, AZ
    totalPermits: "TUCS004BPPRIVSA",
    singleFamilyPermits: "TUCS004BP1FHSA",
    nonfarmEmployment: "TUSC004NA",
    unemploymentRate: "TUCS004URN",
    population: "TUCPOP",
  },
  "28140": {
    // Kansas City, MO-KS
    totalPermits: "KANS129BPPRIVSA",
    singleFamilyPermits: "KANS129BP1FHSA",
    nonfarmEmployment: "KANS129NA",
    unemploymentRate: "KANS129URN",
    population: "KNCPOP",
  },
  "40060": {
    // Richmond, VA
    totalPermits: "RICH051BPPRIVSA",
    singleFamilyPermits: "RICH051BP1FHSA",
    nonfarmEmployment: "RICH051NA",
    unemploymentRate: "RICH051URN",
    population: "VARICH0POP",
  },
  "13820": {
    // Birmingham-Hoover, AL
    totalPermits: "BIRM801BPPRIVSA",
    singleFamilyPermits: "BIRM801BP1FHSA",
    nonfarmEmployment: "BIRM801NA",
    unemploymentRate: "BIRM801URN",
    population: "BIRPOP",
  },
  "32820": {
    // Memphis, TN-MS-AR
    totalPermits: "MPHBPPRIVSA",
    singleFamilyPermits: "MPHBP1FHSA",
    nonfarmEmployment: "MPHNA",
    unemploymentRate: "MPHURN",
    population: "MPHPOP",
  },
  "10740": {
    // Albuquerque, NM
    totalPermits: "ALBU735BPPRIVSA",
    singleFamilyPermits: "ALBU735BP1FHSA",
    nonfarmEmployment: "ALBU735NA",
    unemploymentRate: "ALBU735URN",
    population: "ABQPOP",
  },
};

/**
 * Markets where some demand metrics (typically permits) must be aggregated
 * from county-level FRED series because MSA-level data is missing or stale.
 *
 * County FIPS format: BPPRIV + 0 + 2-digit state + 3-digit county
 */
export const MSA_DEMAND_COUNTY_FALLBACK: Record<string, {
  counties: string[]; // county FIPS codes (6-digit with leading 0)
  // Partial series that ARE available at MSA level (use these when set)
  msaEmployment?: string;
  msaUnemployment?: string;
  msaPopulation?: string;
}> = {
  // Cleveland-Elyria: no MSA permits due to 2023 redesignation.
  // Use post-redesignation Cleveland, OH MSA (C1741) employment series.
  "17460": {
    counties: ["039035", "039055", "039085", "039093", "039103"],
    msaEmployment: "SMS39174100000000001",
    msaPopulation: "CVLPOP",
    msaUnemployment: "CLEV439URN",
  },
  // Providence-Warwick: no MSA permits
  "39300": {
    counties: ["044007", "044003", "044005", "044009", "044001", "025005"],
    msaEmployment: "SMS44393000000000001",
    msaUnemployment: "PROV244URN", // Providence-Warwick NECTA UR (only avail series for this MSA)
    msaPopulation: "PRIPOP",
  },
  // Provo-Orem-Lehi: no MSA permits
  "39340": {
    counties: ["049049", "049023"],
    msaEmployment: "PROV349NA",
    msaUnemployment: "PROV349URN",
    msaPopulation: "PRVPOP",
  },
  // Little Rock-North Little Rock-Conway, AR: no MSA permits, FRED has MSA emp/UR/pop
  "30780": {
    counties: ["005045", "005051", "005053", "005085", "005105", "005119", "005125"],
    msaEmployment: "LRSNA",
    msaUnemployment: "LRSURN",
    msaPopulation: "LRSPOP",
  },
  // Jackson, MS: no MSA permits, FRED has MSA emp/UR/pop
  "27140": {
    counties: ["028029", "028049", "028051", "028089", "028121", "028127", "028163"],
    msaEmployment: "JACK128NA",
    msaUnemployment: "JACK128URN",
    msaPopulation: "JASPOP",
  },
};
