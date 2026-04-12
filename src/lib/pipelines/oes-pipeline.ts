/**
 * BLS OEWS occupation-level pipeline.
 * Fetches employment, mean wage, and median wage for SOC 47-xxxx construction
 * trades across all active MSAs. Computes year-over-year wage growth so the
 * Trade Bottleneck Analyzer can flag the tightest trades.
 */
import { db } from "@/lib/db";
import { geographies, occupationData } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  TRADE_OCCUPATIONS,
  buildOewsSeriesId,
  fetchOewsBatch,
  OES_DATATYPES,
} from "./oes-client";

interface OesPipelineResult {
  marketsProcessed: number;
  recordsInserted: number;
  errors: string[];
}

/**
 * Fetch and store OES data for the most recent two vintages, so YoY change
 * can be computed. BLS releases OEWS annually each spring.
 */
export async function runOesPipeline(
  options: { cbsaFilter?: string[] } = {}
): Promise<OesPipelineResult> {
  const apiKey = process.env.BLS_API_KEY;

  const markets = options.cbsaFilter?.length
    ? await db
        .select()
        .from(geographies)
        .where(and(eq(geographies.isActive, true), inArray(geographies.cbsaFips, options.cbsaFilter)))
    : await db.select().from(geographies).where(eq(geographies.isActive, true));

  const result: OesPipelineResult = { marketsProcessed: 0, recordsInserted: 0, errors: [] };

  // Pull two most-recent annual vintages so we can compute YoY wage change.
  // Current OEWS vintage is May-2024 (released April 2025); add 2023 for YoY.
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 3;
  const endYear = currentYear - 1;

  console.log(
    `[oes-pipeline] Starting for ${markets.length} markets × ${TRADE_OCCUPATIONS.length} occupations, vintages ${startYear}-${endYear}`
  );

  for (const market of markets) {
    try {
      // Build all series IDs for this market: 3 datatypes per occupation
      const idMap = new Map<string, { soc: string; dt: string }>();
      const seriesIds: string[] = [];
      for (const occ of TRADE_OCCUPATIONS) {
        for (const dt of [OES_DATATYPES.EMPLOYMENT, OES_DATATYPES.ANNUAL_MEAN, OES_DATATYPES.ANNUAL_MEDIAN]) {
          const id = buildOewsSeriesId(market.cbsaFips, occ.socCode, dt);
          idMap.set(id, { soc: occ.socCode, dt });
          seriesIds.push(id);
        }
      }

      const seriesData = await fetchOewsBatch(seriesIds, startYear, endYear, apiKey);

      // Reorganize by SOC code → vintage → metrics
      const bySoc = new Map<string, Map<number, { emp?: number; mean?: number; median?: number }>>();
      for (const [seriesId, yearMap] of seriesData.entries()) {
        const meta = idMap.get(seriesId);
        if (!meta) continue;
        if (!bySoc.has(meta.soc)) bySoc.set(meta.soc, new Map());
        const vintages = bySoc.get(meta.soc)!;
        for (const [year, value] of yearMap.entries()) {
          if (!vintages.has(year)) vintages.set(year, {});
          const v = vintages.get(year)!;
          if (meta.dt === OES_DATATYPES.EMPLOYMENT)    v.emp    = value;
          if (meta.dt === OES_DATATYPES.ANNUAL_MEAN)   v.mean   = value;
          if (meta.dt === OES_DATATYPES.ANNUAL_MEDIAN) v.median = value;
        }
      }

      let marketRecords = 0;
      for (const occ of TRADE_OCCUPATIONS) {
        const vintages = bySoc.get(occ.socCode);
        if (!vintages) continue;

        const sortedYears = [...vintages.keys()].sort((a, b) => a - b);
        for (let i = 0; i < sortedYears.length; i++) {
          const year = sortedYears[i];
          const v = vintages.get(year)!;
          if (v.emp == null && v.mean == null && v.median == null) continue;

          const prevYear = sortedYears[i - 1];
          const prev = prevYear ? vintages.get(prevYear) : undefined;
          const yoy =
            prev && prev.mean != null && v.mean != null && prev.mean > 0
              ? ((v.mean - prev.mean) / prev.mean) * 100
              : null;

          await db
            .insert(occupationData)
            .values({
              id: randomUUID(),
              geographyId: market.id,
              vintageYear: year,
              socCode: occ.socCode,
              socTitle: occ.title,
              employment: v.emp != null ? Math.round(v.emp) : null,
              medianHourlyWage: null,
              meanAnnualWage: v.mean != null ? String(v.mean) : null,
              wageYoyChangePct: yoy != null ? String(yoy.toFixed(2)) : null,
              source: "bls_oes",
            })
            .onConflictDoNothing();
          marketRecords++;
        }
      }

      result.recordsInserted += marketRecords;
      result.marketsProcessed++;
      console.log(`  ✓ ${market.shortName}: ${marketRecords} occupation records`);
    } catch (err) {
      const msg = `${market.shortName}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`  ERROR: ${msg}`);
      result.errors.push(msg);
    }
  }

  console.log(
    `[oes-pipeline] Done: ${result.marketsProcessed} markets, ${result.recordsInserted} records, ${result.errors.length} errors`
  );

  return result;
}
