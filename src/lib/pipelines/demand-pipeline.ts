/**
 * Demand data pipeline — fetches permits, employment, unemployment,
 * and population for all active MSAs.
 *
 * Data sources (in priority order):
 *   - Permits: Census BPS (direct XLS, all ~384 MSAs)
 *   - Employment: BLS CES via v2 API (all MSAs with CES coverage)
 *   - Unemployment: BLS LAUS via v2 API (all MSAs)
 *   - Population: Census PEP API (all MSAs)
 *
 * FRED is used as a fallback for the original 52 markets that have
 * known FRED series IDs. For the other 147 markets, the direct APIs
 * are the primary and only source.
 */
import { db } from "@/lib/db";
import { geographies, permitData, employmentData, migrationData } from "@/lib/db/schema";
import { fetchSeries, fetchAggregatedCountyPermits, MSA_SERIES, MSA_DEMAND_COUNTY_FALLBACK } from "./fred-client";
import { fetchBpsMonth } from "./census-bps-client";
import { fetchBlsSeries, cesSeriesId, lausSeriesId, stateAbbrToFips } from "./bls-v2-client";
import { fetchMsaPopulationMultiYear } from "./census-pep-client";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

interface PipelineResult {
  permitsInserted: number;
  employmentInserted: number;
  populationInserted: number;
  errors: string[];
}

function getStartDate(backfill: boolean): string {
  const d = new Date();
  d.setMonth(d.getMonth() - (backfill ? 24 : 3));
  return d.toISOString().slice(0, 10);
}

// ─── Permits via Census BPS ─────────────────────────────────────

async function fetchPermitsBps(
  markets: Array<{ id: string; cbsaFips: string }>,
  backfill: boolean
): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;

  const now = new Date();
  const monthsBack = backfill ? 24 : 3;
  const cbsaToGeoId = new Map(markets.map((m) => [m.cbsaFips, m.id]));

  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i - 2); // BPS has ~6 week lag
    const year = d.getFullYear();
    const month = d.getMonth() + 1;

    try {
      const rows = await fetchBpsMonth(year, month);
      if (!rows) continue;

      for (const row of rows) {
        const geoId = cbsaToGeoId.get(row.cbsaFips);
        if (!geoId) continue;

        const periodDate = `${year}-${String(month).padStart(2, "0")}-01`;
        await db
          .insert(permitData)
          .values({
            id: randomUUID(),
            geographyId: geoId,
            periodDate,
            totalPermits: row.totalUnits,
            singleFamily: row.singleFamily,
            multiFamily: row.multiFamily,
            source: "census_bps",
          })
          .onConflictDoNothing();
        inserted++;
      }
    } catch (err) {
      errors.push(`bps/${year}-${month}: ${err instanceof Error ? err.message : String(err)}`);
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return { inserted, errors };
}

// ─── Employment + Unemployment via BLS v2 ───────────────────────

async function fetchEmploymentBls(
  markets: Array<{ id: string; cbsaFips: string; state: string }>,
  backfill: boolean
): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;

  const now = new Date();
  const startYear = backfill ? now.getFullYear() - 2 : now.getFullYear() - 1;
  const endYear = now.getFullYear();

  // Build series IDs for all markets
  const cesSeries: Array<{ seriesId: string; geoId: string; cbsa: string }> = [];
  const lausSeries: Array<{ seriesId: string; geoId: string; cbsa: string }> = [];

  for (const m of markets) {
    const stateFips = stateAbbrToFips(m.state);
    if (!stateFips) {
      errors.push(`No state FIPS for ${m.state} (${m.cbsaFips})`);
      continue;
    }

    cesSeries.push({
      seriesId: cesSeriesId(stateFips, m.cbsaFips),
      geoId: m.id,
      cbsa: m.cbsaFips,
    });

    lausSeries.push({
      seriesId: lausSeriesId(m.cbsaFips),
      geoId: m.id,
      cbsa: m.cbsaFips,
    });
  }

  // BLS v2 accepts 50 series per request — batch CES and LAUS separately
  const cesMap = new Map(cesSeries.map((s) => [s.seriesId, s]));
  const lausMap = new Map(lausSeries.map((s) => [s.seriesId, s]));

  try {
    console.log(`[demand] Fetching CES for ${cesSeries.length} markets...`);
    const cesResults = await fetchBlsSeries(
      cesSeries.map((s) => s.seriesId),
      startYear,
      endYear
    );

    console.log(`[demand] Fetching LAUS for ${lausSeries.length} markets...`);
    const lausResults = await fetchBlsSeries(
      lausSeries.map((s) => s.seriesId),
      startYear,
      endYear
    );

    // Index LAUS by geoId → date → rate
    const lausByGeo = new Map<string, Map<string, number>>();
    for (const [seriesId, obs] of lausResults) {
      const meta = lausMap.get(seriesId);
      if (!meta) continue;
      const dateMap = new Map<string, number>();
      for (const o of obs) {
        const rate = parseFloat(o.value);
        if (Number.isFinite(rate)) dateMap.set(o.date, rate);
      }
      lausByGeo.set(meta.geoId, dateMap);
    }

    // Insert CES + merge LAUS
    for (const [seriesId, obs] of cesResults) {
      const meta = cesMap.get(seriesId);
      if (!meta) continue;

      const geoLaus = lausByGeo.get(meta.geoId);

      for (const o of obs) {
        const nonfarm = Math.round(parseFloat(o.value) * 1000); // BLS CES in thousands
        if (!Number.isFinite(nonfarm) || nonfarm <= 0) continue;

        const ur = geoLaus?.get(o.date);
        const urStr = ur != null ? String(ur) : null;

        await db
          .insert(employmentData)
          .values({
            id: randomUUID(),
            geographyId: meta.geoId,
            periodDate: o.date,
            totalNonfarm: nonfarm,
            unemploymentRate: urStr,
            source: "bls_ces",
          })
          .onConflictDoNothing();

        if (urStr) {
          await db
            .update(employmentData)
            .set({ unemploymentRate: urStr })
            .where(
              and(
                eq(employmentData.geographyId, meta.geoId),
                eq(employmentData.periodDate, o.date)
              )
            );
        }
        inserted++;
      }
    }
  } catch (err) {
    errors.push(`bls-employment: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { inserted, errors };
}

// ─── Population via Census PEP ──────────────────────────────────

async function fetchPopulationPep(
  markets: Array<{ id: string; cbsaFips: string }>
): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;

  const currentYear = new Date().getFullYear();
  // PEP has ~18 month lag; try the last 3 vintage years
  const years = [currentYear - 2, currentYear - 1, currentYear - 3];

  const cbsaToGeoId = new Map(markets.map((m) => [m.cbsaFips, m.id]));

  try {
    console.log(`[demand] Fetching Census PEP population for vintages ${years.join(", ")}...`);
    const multiYear = await fetchMsaPopulationMultiYear(years);

    for (const [cbsa, rows] of multiYear) {
      const geoId = cbsaToGeoId.get(cbsa);
      if (!geoId) continue;

      for (const row of rows) {
        await db
          .insert(migrationData)
          .values({
            id: randomUUID(),
            geographyId: geoId,
            year: row.year,
            totalPopulation: row.population,
            source: "census_pep",
          })
          .onConflictDoNothing();
        inserted++;
      }
    }
  } catch (err) {
    errors.push(`census-pep: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { inserted, errors };
}

// ─── Legacy FRED path (original 52 markets) ─────────────────────

async function fetchPermitsFred(
  geoId: string,
  cbsaFips: string,
  startDate: string
): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;

  const fallback = MSA_DEMAND_COUNTY_FALLBACK[cbsaFips];
  if (fallback) {
    try {
      const totalObs = await fetchAggregatedCountyPermits(fallback.counties, startDate);
      for (const obs of totalObs) {
        const total = Math.round(parseFloat(obs.value));
        await db
          .insert(permitData)
          .values({
            id: randomUUID(),
            geographyId: geoId,
            periodDate: obs.date,
            totalPermits: total,
            singleFamily: null,
            multiFamily: null,
            source: "fred_county_agg",
          })
          .onConflictDoNothing();
        inserted++;
      }
    } catch (err) {
      errors.push(`permits/${cbsaFips} (county-agg): ${err instanceof Error ? err.message : String(err)}`);
    }
    return { inserted, errors };
  }

  const series = MSA_SERIES[cbsaFips];
  if (!series) return { inserted: 0, errors: [] };

  try {
    const [totalObs, sfObs] = await Promise.all([
      fetchSeries(series.totalPermits, { startDate }),
      fetchSeries(series.singleFamilyPermits, { startDate }),
    ]);
    const sfMap = new Map(sfObs.map((o) => [o.date, Math.round(parseFloat(o.value))]));
    for (const obs of totalObs) {
      const total = Math.round(parseFloat(obs.value));
      const sf = sfMap.get(obs.date) ?? null;
      const mf = sf !== null ? total - sf : null;
      await db
        .insert(permitData)
        .values({
          id: randomUUID(),
          geographyId: geoId,
          periodDate: obs.date,
          totalPermits: total,
          singleFamily: sf,
          multiFamily: mf,
          source: "fred",
        })
        .onConflictDoNothing();
      inserted++;
    }
  } catch (err) {
    errors.push(`permits/${cbsaFips}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { inserted, errors };
}

async function fetchEmploymentFred(
  geoId: string,
  cbsaFips: string,
  startDate: string
): Promise<{ inserted: number; errors: string[] }> {
  const series = MSA_SERIES[cbsaFips];
  const fallback = MSA_DEMAND_COUNTY_FALLBACK[cbsaFips];
  const employmentSeriesId = series?.nonfarmEmployment || fallback?.msaEmployment;
  const unemploymentSeriesId = series?.unemploymentRate || fallback?.msaUnemployment;
  if (!employmentSeriesId) return { inserted: 0, errors: [] };

  const errors: string[] = [];
  let inserted = 0;

  try {
    const [nonfarmObs, urObs] = await Promise.all([
      fetchSeries(employmentSeriesId, { startDate }),
      unemploymentSeriesId ? fetchSeries(unemploymentSeriesId, { startDate }) : Promise.resolve([]),
    ]);
    const urMap = new Map(urObs.map((o) => [o.date, parseFloat(o.value)]));
    for (const obs of nonfarmObs) {
      const nonfarm = Math.round(parseFloat(obs.value) * 1000);
      const ur = urMap.get(obs.date) ?? null;
      const urStr = ur !== null ? String(ur) : null;
      await db
        .insert(employmentData)
        .values({
          id: randomUUID(),
          geographyId: geoId,
          periodDate: obs.date,
          totalNonfarm: nonfarm,
          unemploymentRate: urStr,
          source: "fred",
        })
        .onConflictDoNothing();
      if (urStr) {
        await db
          .update(employmentData)
          .set({ unemploymentRate: urStr })
          .where(
            and(
              eq(employmentData.geographyId, geoId),
              eq(employmentData.periodDate, obs.date)
            )
          );
      }
      inserted++;
    }
  } catch (err) {
    errors.push(`employment/${cbsaFips}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { inserted, errors };
}

async function fetchPopulationFred(
  geoId: string,
  cbsaFips: string,
  startDate: string
): Promise<{ inserted: number; errors: string[] }> {
  const series = MSA_SERIES[cbsaFips];
  const fallback = MSA_DEMAND_COUNTY_FALLBACK[cbsaFips];
  const populationSeriesId = series?.population || fallback?.msaPopulation;
  if (!populationSeriesId) return { inserted: 0, errors: [] };

  const errors: string[] = [];
  let inserted = 0;

  try {
    const popObs = await fetchSeries(populationSeriesId, { startDate });
    for (const obs of popObs) {
      const pop = Math.round(parseFloat(obs.value) * 1000);
      const year = parseInt(obs.date.slice(0, 4), 10);
      await db
        .insert(migrationData)
        .values({
          id: randomUUID(),
          geographyId: geoId,
          year,
          totalPopulation: pop,
          source: "fred",
        })
        .onConflictDoNothing();
      inserted++;
    }
  } catch (err) {
    errors.push(`population/${cbsaFips}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { inserted, errors };
}

// ─── Pipeline entry points ──────────────────────────────────────

export async function runDemandPipelineForCbsas(
  cbsaFipsList: string[],
  backfill = false
): Promise<PipelineResult> {
  return runDemandPipelineInternal(backfill, cbsaFipsList);
}

export async function runDemandPipeline(backfill = false): Promise<PipelineResult> {
  return runDemandPipelineInternal(backfill);
}

async function runDemandPipelineInternal(
  backfill: boolean,
  cbsaFilter?: string[]
): Promise<PipelineResult> {
  const markets = cbsaFilter && cbsaFilter.length
    ? await db.select().from(geographies).where(and(eq(geographies.isActive, true), inArray(geographies.cbsaFips, cbsaFilter)))
    : await db.select().from(geographies).where(eq(geographies.isActive, true));

  const startDate = getStartDate(backfill);
  const result: PipelineResult = {
    permitsInserted: 0,
    employmentInserted: 0,
    populationInserted: 0,
    errors: [],
  };

  console.log(
    `[demand] Starting for ${markets.length} markets, backfill=${backfill}`
  );

  // Split markets: FRED path (have series IDs) vs direct API path
  const fredMarkets = markets.filter((m) => MSA_SERIES[m.cbsaFips] || MSA_DEMAND_COUNTY_FALLBACK[m.cbsaFips]);
  const directMarkets = markets.filter((m) => !MSA_SERIES[m.cbsaFips] && !MSA_DEMAND_COUNTY_FALLBACK[m.cbsaFips]);

  console.log(`[demand] FRED path: ${fredMarkets.length} markets, Direct API path: ${directMarkets.length} markets`);

  // ── Direct API path (bulk operations) ──

  if (directMarkets.length > 0) {
    // Census BPS — permits for all markets in one pass per month
    const allMarketsForBps = markets.map((m) => ({ id: m.id, cbsaFips: m.cbsaFips }));
    const bpsResult = await fetchPermitsBps(allMarketsForBps, backfill);
    result.permitsInserted += bpsResult.inserted;
    result.errors.push(...bpsResult.errors);

    // BLS CES + LAUS — employment + unemployment
    const blsResult = await fetchEmploymentBls(
      directMarkets.map((m) => ({ id: m.id, cbsaFips: m.cbsaFips, state: m.state })),
      backfill
    );
    result.employmentInserted += blsResult.inserted;
    result.errors.push(...blsResult.errors);

    // Census PEP — population
    const pepResult = await fetchPopulationPep(
      directMarkets.map((m) => ({ id: m.id, cbsaFips: m.cbsaFips }))
    );
    result.populationInserted += pepResult.inserted;
    result.errors.push(...pepResult.errors);
  }

  // ── FRED path (per-market, legacy) ──

  for (const market of fredMarkets) {
    await new Promise((r) => setTimeout(r, 500));

    const [permits, employment, population] = await Promise.all([
      fetchPermitsFred(market.id, market.cbsaFips, startDate),
      fetchEmploymentFred(market.id, market.cbsaFips, startDate),
      fetchPopulationFred(market.id, market.cbsaFips, startDate),
    ]);

    result.permitsInserted += permits.inserted;
    result.employmentInserted += employment.inserted;
    result.populationInserted += population.inserted;
    result.errors.push(...permits.errors, ...employment.errors, ...population.errors);
  }

  console.log(
    `[demand] Done: ${result.permitsInserted} permits, ${result.employmentInserted} employment, ${result.populationInserted} population, ${result.errors.length} errors`
  );

  return result;
}
