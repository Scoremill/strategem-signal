/**
 * Business-case data loader.
 *
 * Given a geography id, fetch the three raw inputs the Phase 3 entry
 * models need:
 *
 *   1. Zillow ZHVI — latest median home value for the metro (drives
 *      land basis + projected sale price)
 *   2. BLS QCEW — employment-weighted construction trade wage for
 *      the latest quarter (drives base build cost)
 *   3. Filter 4 targets — public builders known to operate in the
 *      market, from ops_builder_markets (drives the acquisition path)
 *
 * Pure DB reads. No scoring here — that's the scorer modules' job.
 * Returning a single bundle keeps the page/API callers simple.
 */
import { db } from "@/lib/db";
import {
  zillowZhvi,
  tradeCapacityData,
  opsBuilderMarkets,
  opsCompanies,
} from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import type {
  OrganicRawInputs,
} from "./organic-entry-model";
import type {
  AcquisitionRawInputs,
} from "./acquisition-entry-model";
import type { AcquisitionTarget } from "./types";

export interface BusinessCaseRawInputs {
  organic: OrganicRawInputs;
  /**
   * Note: acquisition raw inputs need the organic cost-per-unit,
   * which is only known after the organic model has run. The loader
   * returns the target list only; callers assemble the full
   * AcquisitionRawInputs once they have the organic output.
   */
  acquisitionTargets: AcquisitionTarget[];
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

async function loadMedianHomePrice(
  geographyId: string
): Promise<OrganicRawInputs["medianHomePrice"]> {
  const rows = await db
    .select({
      value: zillowZhvi.medianHomeValue,
      periodDate: zillowZhvi.periodDate,
    })
    .from(zillowZhvi)
    .where(eq(zillowZhvi.geographyId, geographyId))
    .orderBy(desc(zillowZhvi.periodDate))
    .limit(1);
  if (rows.length === 0) return { value: null, asOf: null };
  return {
    value: rows[0].value ?? null,
    asOf: rows[0].periodDate ?? null,
  };
}

async function loadConstructionWage(
  geographyId: string
): Promise<OrganicRawInputs["constructionAvgWeeklyWage"]> {
  // Employment-weighted avg across NAICS 238x codes for the latest quarter
  const rows = await db
    .select({
      emp: tradeCapacityData.avgMonthlyEmployment,
      wage: tradeCapacityData.avgWeeklyWage,
      periodDate: tradeCapacityData.periodDate,
    })
    .from(tradeCapacityData)
    .where(
      sql`${tradeCapacityData.geographyId} = ${geographyId}
         AND ${tradeCapacityData.periodDate} = (
           SELECT MAX(${tradeCapacityData.periodDate})
           FROM ${tradeCapacityData}
           WHERE ${tradeCapacityData.geographyId} = ${geographyId}
         )`
    );
  if (rows.length === 0) return { value: null, asOf: null };
  let wsum = 0;
  let wweight = 0;
  for (const r of rows) {
    const emp = r.emp ?? 0;
    const wage = toNumber(r.wage);
    if (emp <= 0 || wage === null) continue;
    wsum += wage * emp;
    wweight += emp;
  }
  const value = wweight > 0 ? wsum / wweight : null;
  return {
    value: value !== null ? Math.round(value) : null,
    asOf: rows[0].periodDate ?? null,
  };
}

async function loadAcquisitionTargets(
  geographyId: string
): Promise<AcquisitionTarget[]> {
  const rows = await db
    .select({
      ticker: opsBuilderMarkets.builderTicker,
      confidence: opsBuilderMarkets.confidence,
      firstSeenYear: opsBuilderMarkets.firstSeenYear,
      lastSeenYear: opsBuilderMarkets.lastSeenYear,
      mentionCount: opsBuilderMarkets.mentionCount,
      companyName: opsCompanies.companyName,
    })
    .from(opsBuilderMarkets)
    .leftJoin(
      opsCompanies,
      eq(opsBuilderMarkets.builderTicker, opsCompanies.ticker)
    )
    .where(eq(opsBuilderMarkets.geographyId, geographyId));

  return rows.map((r) => ({
    ticker: r.ticker,
    companyName: r.companyName ?? null,
    confidence: r.confidence ?? "low",
    firstSeenYear: r.firstSeenYear ?? null,
    lastSeenYear: r.lastSeenYear ?? null,
    mentionCount: r.mentionCount ?? 0,
  }));
}

export async function loadBusinessCaseInputs(
  geographyId: string
): Promise<BusinessCaseRawInputs> {
  const [medianHomePrice, constructionAvgWeeklyWage, acquisitionTargets] =
    await Promise.all([
      loadMedianHomePrice(geographyId),
      loadConstructionWage(geographyId),
      loadAcquisitionTargets(geographyId),
    ]);

  return {
    organic: {
      medianHomePrice,
      constructionAvgWeeklyWage,
    },
    acquisitionTargets,
  };
}

/**
 * Helper for callers that want the fully-computed AcquisitionRawInputs
 * after the organic model has run.
 */
export function toAcquisitionRawInputs(
  targets: AcquisitionTarget[],
  organicCapitalPerUnit: number | null
): AcquisitionRawInputs {
  return {
    targets,
    organicCapitalPerUnit,
  };
}
