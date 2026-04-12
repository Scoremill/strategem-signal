/**
 * Demand data pipeline — fetches permits, employment, and population
 * from FRED for all active MSAs and stores in the database.
 */
import { db } from "@/lib/db";
import { geographies, permitData, employmentData, migrationData } from "@/lib/db/schema";
import { fetchSeries, fetchAggregatedCountyPermits, MSA_SERIES, MSA_DEMAND_COUNTY_FALLBACK } from "./fred-client";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

interface PipelineResult {
  permitsInserted: number;
  employmentInserted: number;
  populationInserted: number;
  errors: string[];
}

/**
 * Calculate start date for data fetch — 24 months back for backfill, 3 months for refresh.
 */
function getStartDate(backfill: boolean): string {
  const d = new Date();
  d.setMonth(d.getMonth() - (backfill ? 24 : 3));
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch and store building permits for an MSA.
 */
async function fetchPermits(
  geoId: string,
  cbsaFips: string,
  startDate: string
): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;

  // County aggregation fallback for markets without MSA-level permits
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
            singleFamily: null, // county data doesn't split
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
  if (!series) return { inserted: 0, errors: [`No FRED series for CBSA ${cbsaFips}`] };

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

/**
 * Fetch and store employment data for an MSA.
 */
async function fetchEmployment(
  geoId: string,
  cbsaFips: string,
  startDate: string
): Promise<{ inserted: number; errors: string[] }> {
  // Resolve series IDs — prefer MSA_SERIES, fall back to MSA_DEMAND_COUNTY_FALLBACK
  const series = MSA_SERIES[cbsaFips];
  const fallback = MSA_DEMAND_COUNTY_FALLBACK[cbsaFips];
  const employmentSeriesId = series?.nonfarmEmployment || fallback?.msaEmployment;
  const unemploymentSeriesId = series?.unemploymentRate || fallback?.msaUnemployment;

  if (!employmentSeriesId) {
    return { inserted: 0, errors: [`No employment series for CBSA ${cbsaFips}`] };
  }

  const errors: string[] = [];
  let inserted = 0;

  try {
    const [nonfarmObs, urObs] = await Promise.all([
      fetchSeries(employmentSeriesId, { startDate }),
      unemploymentSeriesId ? fetchSeries(unemploymentSeriesId, { startDate }) : Promise.resolve([]),
    ]);

    // Index unemployment rate by date
    const urMap = new Map(urObs.map((o) => [o.date, parseFloat(o.value)]));

    for (const obs of nonfarmObs) {
      const nonfarm = Math.round(parseFloat(obs.value) * 1000); // FRED reports in thousands
      const ur = urMap.get(obs.date) ?? null;

      // Use raw SQL upsert to update unemployment rate on existing records
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

      // Update unemployment rate on existing records if we have it
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

/**
 * Fetch and store population data for an MSA.
 */
async function fetchPopulation(
  geoId: string,
  cbsaFips: string,
  startDate: string
): Promise<{ inserted: number; errors: string[] }> {
  const series = MSA_SERIES[cbsaFips];
  const fallback = MSA_DEMAND_COUNTY_FALLBACK[cbsaFips];
  const populationSeriesId = series?.population || fallback?.msaPopulation;

  if (!populationSeriesId) {
    return { inserted: 0, errors: [`No population series for CBSA ${cbsaFips}`] };
  }

  const errors: string[] = [];
  let inserted = 0;

  try {
    const popObs = await fetchSeries(populationSeriesId, { startDate });

    for (const obs of popObs) {
      const pop = Math.round(parseFloat(obs.value) * 1000); // FRED reports in thousands
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

/**
 * Run the demand pipeline scoped to a specific list of CBSA FIPS codes.
 * Used for targeted backfills (e.g., new market additions) without re-running all 50+.
 */
export async function runDemandPipelineForCbsas(
  cbsaFipsList: string[],
  backfill = false
): Promise<PipelineResult> {
  return runDemandPipelineInternal(backfill, cbsaFipsList);
}

/**
 * Run the full demand pipeline for all active MSAs.
 */
export async function runDemandPipeline(backfill = false): Promise<PipelineResult> {
  return runDemandPipelineInternal(backfill);
}

async function runDemandPipelineInternal(
  backfill: boolean,
  cbsaFilter?: string[]
): Promise<PipelineResult> {
  const baseQuery = db.select().from(geographies).where(eq(geographies.isActive, true));
  const markets = cbsaFilter && cbsaFilter.length
    ? await db.select().from(geographies).where(and(eq(geographies.isActive, true), inArray(geographies.cbsaFips, cbsaFilter)))
    : await baseQuery;
  const startDate = getStartDate(backfill);
  const result: PipelineResult = {
    permitsInserted: 0,
    employmentInserted: 0,
    populationInserted: 0,
    errors: [],
  };

  console.log(
    `[demand-pipeline] Starting for ${markets.length} markets, startDate=${startDate}, backfill=${backfill}`
  );

  for (const market of markets) {
    console.log(`[demand-pipeline] Processing ${market.shortName} (${market.cbsaFips})...`);

    // Small delay between MSAs to respect FRED rate limits
    await new Promise((r) => setTimeout(r, 500));

    const [permits, employment, population] = await Promise.all([
      fetchPermits(market.id, market.cbsaFips, startDate),
      fetchEmployment(market.id, market.cbsaFips, startDate),
      fetchPopulation(market.id, market.cbsaFips, startDate),
    ]);

    result.permitsInserted += permits.inserted;
    result.employmentInserted += employment.inserted;
    result.populationInserted += population.inserted;
    result.errors.push(...permits.errors, ...employment.errors, ...population.errors);
  }

  console.log(
    `[demand-pipeline] Done: ${result.permitsInserted} permits, ${result.employmentInserted} employment, ${result.populationInserted} population, ${result.errors.length} errors`
  );

  return result;
}
