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
};
