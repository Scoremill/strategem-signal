/**
 * Census Population Estimates Program (PEP) client.
 *
 * Fetches annual population estimates by CBSA/MSA.
 * No API key required (but rate-limited without one).
 *
 * Data lag: ~18 months. 2023 estimates released May 2024.
 * Vintage = the base year of the estimate series.
 */

const BASE_URL = "https://api.census.gov/data";

export interface PepPopulationRow {
  cbsaFips: string;
  name: string;
  population: number;
  year: number;
}

/**
 * Fetch population for all MSAs for a given vintage year.
 * Returns a map of CBSA FIPS → population record.
 *
 * Census PEP publishes multiple years per vintage. We fetch the
 * most recent year available in the vintage.
 */
export async function fetchMsaPopulation(
  vintage: number
): Promise<Map<string, PepPopulationRow>> {
  const popVar = `POP_${vintage}`;
  const url = `${BASE_URL}/${vintage}/pep/population?get=NAME,${popVar}&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:*`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      // Vintage not available yet — try without the year suffix
      return fetchMsaPopulationFallback(vintage);
    }
    throw new Error(`Census PEP API error ${res.status}: ${await res.text()}`);
  }

  const rows: string[][] = await res.json();
  const result = new Map<string, PepPopulationRow>();

  // First row is headers
  for (let i = 1; i < rows.length; i++) {
    const [name, pop, cbsa] = rows[i];
    if (!cbsa || !pop) continue;
    const population = parseInt(pop, 10);
    if (!Number.isFinite(population) || population <= 0) continue;

    result.set(cbsa, {
      cbsaFips: cbsa,
      name: name.replace(/ Metro(politan)? Statistical Area/i, ""),
      population,
      year: vintage,
    });
  }

  return result;
}

/**
 * Fallback for vintages where POP_{YEAR} variable doesn't exist.
 * Census sometimes uses different variable names across vintages.
 */
async function fetchMsaPopulationFallback(
  vintage: number
): Promise<Map<string, PepPopulationRow>> {
  // Try POPESTIMATE variable (used in some PEP vintages)
  const url = `${BASE_URL}/${vintage}/pep/population?get=NAME,POPESTIMATE&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:*`;

  try {
    const res = await fetch(url);
    if (!res.ok) return new Map();

    const rows: string[][] = await res.json();
    const result = new Map<string, PepPopulationRow>();

    for (let i = 1; i < rows.length; i++) {
      const [name, pop, cbsa] = rows[i];
      if (!cbsa || !pop) continue;
      const population = parseInt(pop, 10);
      if (!Number.isFinite(population) || population <= 0) continue;

      result.set(cbsa, {
        cbsaFips: cbsa,
        name,
        population,
        year: vintage,
      });
    }

    return result;
  } catch {
    return new Map();
  }
}

/**
 * Fetch population for multiple vintage years and return all results.
 * Useful for computing YoY population change.
 */
export async function fetchMsaPopulationMultiYear(
  years: number[]
): Promise<Map<string, PepPopulationRow[]>> {
  const result = new Map<string, PepPopulationRow[]>();

  for (const year of years) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const yearData = await fetchMsaPopulation(year);
      for (const [cbsa, row] of yearData) {
        const existing = result.get(cbsa) || [];
        existing.push(row);
        result.set(cbsa, existing);
      }
    } catch (err) {
      console.warn(`[census-pep] Failed to fetch vintage ${year}:`, err);
    }
  }

  return result;
}
