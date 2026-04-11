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
};
