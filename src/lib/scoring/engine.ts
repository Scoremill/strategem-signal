/**
 * Demand-Capacity Scoring Engine
 *
 * Computes:
 * 1. Demand Index (0-100) — weighted composite of permit, employment, and population metrics
 * 2. Capacity Index (0-100) — weighted composite of trade employment, wages (inverse), establishments
 * 3. Demand-Capacity Ratio — demand / capacity
 * 4. Status classification: constrained (>1.15), equilibrium (0.85-1.15), favorable (<0.85)
 * 5. Velocity: 3m, 6m, 12m rates of change
 * 6. Percentile rankings across all MSAs
 */

import { db } from "@/lib/db";
import {
  geographies,
  permitData,
  employmentData,
  migrationData,
  tradeCapacityData,
  demandScores,
  capacityScores,
  demandCapacityScores,
} from "@/lib/db/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { randomUUID } from "crypto";

// ─── Default Weights ─────────────────────────────────────────────
const DEMAND_WEIGHTS = {
  permits: 0.35,
  employment: 0.30,
  population: 0.20,
  unemployment: 0.15, // inverse — low unemployment = high demand signal
};

const CAPACITY_WEIGHTS = {
  tradeEmployment: 0.25,
  wageAcceleration: 0.25, // INVERSE — high wage growth = low capacity
  establishments: 0.20,
  permitsPerWorker: 0.30, // INVERSE — high ratio = capacity stress
};

// ─── Types ───────────────────────────────────────────────────────
interface MarketMetrics {
  geographyId: string;
  shortName: string;
  // Demand raw values
  latestPermits: number | null;
  permitGrowthYoy: number | null;
  latestEmployment: number | null;
  employmentGrowthYoy: number | null;
  population: number | null;
  unemploymentRate: number | null;
  // Capacity raw values
  tradeWorkers: number | null;
  avgWeeklyWage: number | null;
  wageGrowthYoy: number | null;
  establishments: number | null;
  permitsPerWorker: number | null;
}

interface ScoredMarket {
  geographyId: string;
  shortName: string;
  // Component scores (0-100 percentiles)
  permitScore: number;
  employmentScore: number;
  populationScore: number;
  unemploymentScore: number;
  // Demand index
  demandIndex: number;
  // Capacity component scores
  tradeEmploymentScore: number;
  wageAccelerationScore: number;
  establishmentScore: number;
  permitsPerWorkerScore: number;
  // Capacity index
  capacityIndex: number;
  // Ratio
  demandCapacityRatio: number;
  status: "favorable" | "equilibrium" | "constrained";
  // Trade Availability: workers per permit, adjusted for wage pressure
  tradeAvailability: number;
}

// ─── Percentile Ranking ──────────────────────────────────────────

/**
 * Rank values as percentiles (0-100) across all markets.
 * Higher value = higher percentile.
 */
function percentileRank(values: (number | null)[]): number[] {
  const validValues = values.filter((v): v is number => v !== null);
  if (validValues.length === 0) return values.map(() => 50);

  const sorted = [...validValues].sort((a, b) => a - b);

  return values.map((v) => {
    if (v === null) return 50; // neutral for missing data
    const rank = sorted.filter((s) => s < v).length;
    return Math.round((rank / (sorted.length - 1 || 1)) * 100);
  });
}

/**
 * Inverse percentile — high raw value = LOW score (capacity constraint signal).
 */
function inversePercentileRank(values: (number | null)[]): number[] {
  return percentileRank(values).map((p) => 100 - p);
}

// ─── Data Collection ─────────────────────────────────────────────

async function collectMarketMetrics(): Promise<MarketMetrics[]> {
  const markets = await db
    .select()
    .from(geographies)
    .where(eq(geographies.isActive, true))
    .orderBy(geographies.shortName);

  const metrics: MarketMetrics[] = [];

  for (const market of markets) {
    // Latest permits
    const [latestPermit] = await db
      .select()
      .from(permitData)
      .where(eq(permitData.geographyId, market.id))
      .orderBy(desc(permitData.periodDate))
      .limit(1);

    // Permit from 12 months ago for YoY
    const [priorPermit] = latestPermit
      ? await db
          .select()
          .from(permitData)
          .where(
            and(
              eq(permitData.geographyId, market.id),
              sql`${permitData.periodDate} <= ${latestPermit.periodDate}::date - interval '11 months'`
            )
          )
          .orderBy(desc(permitData.periodDate))
          .limit(1)
      : [undefined];

    // Latest employment
    const [latestEmp] = await db
      .select()
      .from(employmentData)
      .where(eq(employmentData.geographyId, market.id))
      .orderBy(desc(employmentData.periodDate))
      .limit(1);

    // Employment from 12 months ago
    const [priorEmp] = latestEmp
      ? await db
          .select()
          .from(employmentData)
          .where(
            and(
              eq(employmentData.geographyId, market.id),
              sql`${employmentData.periodDate} <= ${latestEmp.periodDate}::date - interval '11 months'`
            )
          )
          .orderBy(desc(employmentData.periodDate))
          .limit(1)
      : [undefined];

    // Latest population
    const [latestPop] = await db
      .select()
      .from(migrationData)
      .where(eq(migrationData.geographyId, market.id))
      .orderBy(desc(migrationData.year))
      .limit(1);

    // Latest trade capacity (aggregate across NAICS codes)
    const [tradeCap] = await db
      .select({
        totalWorkers: sql<number>`SUM(avg_monthly_employment)`,
        avgWage: sql<number>`ROUND(AVG(CAST(avg_weekly_wage AS numeric)))`,
        avgWageYoy: sql<number>`ROUND(AVG(CAST(wage_yoy_change_pct AS numeric)), 1)`,
        totalEstabs: sql<number>`SUM(establishment_count)`,
      })
      .from(tradeCapacityData)
      .where(
        and(
          eq(tradeCapacityData.geographyId, market.id),
          sql`${tradeCapacityData.periodDate} = (
            SELECT MAX(period_date) FROM trade_capacity_data WHERE geography_id = ${market.id}
          )`
        )
      );

    const totalWorkers = Number(tradeCap?.totalWorkers) || null;
    const latestPermits = latestPermit?.totalPermits ?? null;

    // Compute YoY growth rates
    const permitGrowthYoy =
      latestPermit && priorPermit && priorPermit.totalPermits > 0
        ? ((latestPermit.totalPermits - priorPermit.totalPermits) / priorPermit.totalPermits) * 100
        : null;

    const employmentGrowthYoy =
      latestEmp?.totalNonfarm && priorEmp?.totalNonfarm && priorEmp.totalNonfarm > 0
        ? ((latestEmp.totalNonfarm - priorEmp.totalNonfarm) / priorEmp.totalNonfarm) * 100
        : null;

    metrics.push({
      geographyId: market.id,
      shortName: market.shortName,
      latestPermits,
      permitGrowthYoy,
      latestEmployment: latestEmp?.totalNonfarm ?? null,
      employmentGrowthYoy,
      population: latestPop?.totalPopulation ?? null,
      unemploymentRate: latestEmp?.unemploymentRate ? parseFloat(String(latestEmp.unemploymentRate)) : null,
      tradeWorkers: totalWorkers,
      avgWeeklyWage: Number(tradeCap?.avgWage) || null,
      wageGrowthYoy: Number(tradeCap?.avgWageYoy) || null,
      establishments: Number(tradeCap?.totalEstabs) || null,
      permitsPerWorker:
        latestPermits && totalWorkers ? latestPermits / totalWorkers : null,
    });
  }

  return metrics;
}

// ─── Scoring ─────────────────────────────────────────────────────

function scoreMarkets(metrics: MarketMetrics[]): ScoredMarket[] {
  // Extract arrays for percentile ranking
  const permitVals = metrics.map((m) => m.latestPermits);
  const permitGrowthVals = metrics.map((m) => m.permitGrowthYoy);
  const empVals = metrics.map((m) => m.latestEmployment);
  const empGrowthVals = metrics.map((m) => m.employmentGrowthYoy);
  const popVals = metrics.map((m) => m.population);
  const urVals = metrics.map((m) => m.unemploymentRate);

  const tradeEmpVals = metrics.map((m) => m.tradeWorkers);
  const wageGrowthVals = metrics.map((m) => m.wageGrowthYoy);
  const estabVals = metrics.map((m) => m.establishments);
  const ppwVals = metrics.map((m) => m.permitsPerWorker);

  // Demand percentiles (higher = more demand)
  const permitPctls = percentileRank(permitVals);
  const permitGrowthPctls = percentileRank(permitGrowthVals);
  const empPctls = percentileRank(empVals);
  const empGrowthPctls = percentileRank(empGrowthVals);
  const popPctls = percentileRank(popVals);
  const urPctls = inversePercentileRank(urVals); // Low unemployment = high demand

  // Capacity percentiles
  const tradeEmpPctls = percentileRank(tradeEmpVals); // More workers = more capacity
  const wageGrowthPctls = inversePercentileRank(wageGrowthVals); // High wages = LOW capacity
  const estabPctls = percentileRank(estabVals); // More firms = more capacity
  const ppwPctls = inversePercentileRank(ppwVals); // High permits/worker = LOW capacity

  return metrics.map((m, i) => {
    // Demand: blend permit volume/growth, employment volume/growth, population, unemployment
    const permitScore = Math.round((permitPctls[i] + permitGrowthPctls[i]) / 2);
    const employmentScore = Math.round((empPctls[i] + empGrowthPctls[i]) / 2);
    const populationScore = popPctls[i];
    const unemploymentScore = urPctls[i];

    const demandIndex = Math.round(
      permitScore * DEMAND_WEIGHTS.permits +
        employmentScore * DEMAND_WEIGHTS.employment +
        populationScore * DEMAND_WEIGHTS.population +
        unemploymentScore * DEMAND_WEIGHTS.unemployment
    );

    // Capacity: trade employment, wage acceleration (inverse), establishments, permits-per-worker (inverse)
    const tradeEmploymentScore = tradeEmpPctls[i];
    const wageAccelerationScore = wageGrowthPctls[i];
    const establishmentScore = estabPctls[i];
    const permitsPerWorkerScore = ppwPctls[i];

    const capacityIndex = Math.round(
      tradeEmploymentScore * CAPACITY_WEIGHTS.tradeEmployment +
        wageAccelerationScore * CAPACITY_WEIGHTS.wageAcceleration +
        establishmentScore * CAPACITY_WEIGHTS.establishments +
        permitsPerWorkerScore * CAPACITY_WEIGHTS.permitsPerWorker
    );

    // Ratio
    const safeCapacity = Math.max(capacityIndex, 1);
    const demandCapacityRatio = Math.round((demandIndex / safeCapacity) * 1000) / 1000;

    // Status
    let status: "favorable" | "equilibrium" | "constrained";
    if (demandCapacityRatio > 1.15) status = "constrained";
    else if (demandCapacityRatio < 0.85) status = "favorable";
    else status = "equilibrium";

    // Trade Availability: workers per permit, discounted by wage pressure
    // Formula: (trade workers / monthly permits) × wage stability factor
    // Wage stability factor: 1.0 when wages flat, decreasing as wages accelerate
    // Higher number = more workers available per unit of demand
    const wageYoy = m.wageGrowthYoy ?? 0;
    const wageStabilityFactor = Math.max(0.3, 1.0 - (wageYoy / 20)); // 0% wage growth = 1.0, 14%+ = 0.3
    const rawAvailability = m.tradeWorkers && m.latestPermits && m.latestPermits > 0
      ? m.tradeWorkers / m.latestPermits
      : null;
    const tradeAvailability = rawAvailability !== null
      ? Math.round(rawAvailability * wageStabilityFactor * 100) / 100
      : 0;

    return {
      geographyId: m.geographyId,
      shortName: m.shortName,
      permitScore,
      employmentScore,
      populationScore,
      unemploymentScore,
      demandIndex,
      tradeEmploymentScore,
      wageAccelerationScore,
      establishmentScore,
      permitsPerWorkerScore,
      capacityIndex,
      demandCapacityRatio,
      status,
      tradeAvailability,
    };
  });
}

// ─── Persist Scores ──────────────────────────────────────────────

async function persistScores(scored: ScoredMarket[], scoreDate: string): Promise<number> {
  let inserted = 0;

  // Compute percentile rankings for the three main metrics
  const demandVals = scored.map((s) => s.demandIndex);
  const capVals = scored.map((s) => s.capacityIndex);
  const ratioVals = scored.map((s) => s.demandCapacityRatio);
  const demandPctls = percentileRank(demandVals);
  const capPctls = percentileRank(capVals);
  const ratioPctls = percentileRank(ratioVals);

  for (let i = 0; i < scored.length; i++) {
    const s = scored[i];

    // Demand scores
    await db
      .insert(demandScores)
      .values({
        id: randomUUID(),
        geographyId: s.geographyId,
        scoreDate,
        permitScore: String(s.permitScore),
        employmentScore: String(s.employmentScore),
        migrationScore: String(s.populationScore),
        incomeScore: String(s.unemploymentScore),
        demandIndex: String(s.demandIndex),
      })
      .onConflictDoNothing();

    // Capacity scores
    await db
      .insert(capacityScores)
      .values({
        id: randomUUID(),
        geographyId: s.geographyId,
        scoreDate,
        tradeEmploymentScore: String(s.tradeEmploymentScore),
        wageAccelerationScore: String(s.wageAccelerationScore),
        establishmentScore: String(s.establishmentScore),
        permitsPerWorkerScore: String(s.permitsPerWorkerScore),
        capacityIndex: String(s.capacityIndex),
      })
      .onConflictDoNothing();

    // Master demand-capacity scores
    await db
      .insert(demandCapacityScores)
      .values({
        id: randomUUID(),
        geographyId: s.geographyId,
        scoreDate,
        demandIndex: String(s.demandIndex),
        capacityIndex: String(s.capacityIndex),
        demandCapacityRatio: String(s.demandCapacityRatio),
        status: s.status,
        tradeAvailability: String(s.tradeAvailability),
        demandPercentileRank: String(demandPctls[i]),
        capacityPercentileRank: String(capPctls[i]),
        ratioPercentileRank: String(ratioPctls[i]),
      })
      .onConflictDoNothing();

    inserted++;
  }

  return inserted;
}

// ─── Main Entry Point ────────────────────────────────────────────

export interface ScoringResult {
  marketsScored: number;
  scores: Array<{
    market: string;
    demandIndex: number;
    capacityIndex: number;
    ratio: number;
    status: string;
    tradeAvailability: number;
  }>;
  errors: string[];
}

export async function runScoringEngine(): Promise<ScoringResult> {
  console.log("[scoring-engine] Collecting market metrics...");
  const metrics = await collectMarketMetrics();

  console.log("[scoring-engine] Scoring markets...");
  const scored = scoreMarkets(metrics);

  const scoreDate = new Date().toISOString().slice(0, 10);
  console.log(`[scoring-engine] Persisting scores for ${scoreDate}...`);
  const inserted = await persistScores(scored, scoreDate);

  // Log summary
  const summary = scored
    .sort((a, b) => b.demandCapacityRatio - a.demandCapacityRatio)
    .map((s) => ({
      market: s.shortName,
      demandIndex: s.demandIndex,
      capacityIndex: s.capacityIndex,
      ratio: s.demandCapacityRatio,
      status: s.status,
      tradeAvailability: s.tradeAvailability,
    }));

  console.log("[scoring-engine] Results:");
  for (const s of summary) {
    const icon = s.status === "constrained" ? "🔴" : s.status === "equilibrium" ? "🟡" : "🟢";
    console.log(`  ${icon} ${s.market}: D=${s.demandIndex} C=${s.capacityIndex} R=${s.ratio} (${s.status})`);
  }

  return {
    marketsScored: inserted,
    scores: summary,
    errors: [],
  };
}
