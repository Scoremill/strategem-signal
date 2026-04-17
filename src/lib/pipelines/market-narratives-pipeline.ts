/**
 * Market narratives pipeline. Regenerates the cached blurbs for
 * every active market from the latest Portfolio Health + Market
 * Opportunity snapshots. Runs monthly via a dedicated cron so its
 * ~10 minute OpenAI workload doesn't block the scoring crons.
 *
 * Idempotent — re-runs for the same snapshot_date upsert in place.
 */
import { db } from "@/lib/db";
import {
  geographies,
  portfolioHealthSnapshots,
  marketOpportunityScores,
  opsBuilderMarkets,
  marketNarratives,
} from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import OpenAI from "openai";
import {
  generateMarketNarratives,
  type PortfolioHealthInputs,
  type MarketOpportunityBlurbInputs,
} from "@/lib/narrative/market-narrative";

export interface MarketNarrativesResult {
  marketsProcessed: number;
  marketsGenerated: number;
  marketsSkipped: number;
  errors: string[];
  durationMs: number;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function toYmd(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

export async function runMarketNarrativesPipeline(): Promise<MarketNarrativesResult> {
  const startedAt = Date.now();
  const result: MarketNarrativesResult = {
    marketsProcessed: 0,
    marketsGenerated: 0,
    marketsSkipped: 0,
    errors: [],
    durationMs: 0,
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    result.errors.push("OPENAI_API_KEY not set");
    return result;
  }
  const client = new OpenAI({ apiKey });

  const geos = await db
    .select()
    .from(geographies)
    .where(eq(geographies.isActive, true));
  console.log(`[market-narratives] ${geos.length} active markets`);

  for (const g of geos) {
    result.marketsProcessed++;

    const [healthRow] = await db
      .select()
      .from(portfolioHealthSnapshots)
      .where(eq(portfolioHealthSnapshots.geographyId, g.id))
      .orderBy(desc(portfolioHealthSnapshots.snapshotDate))
      .limit(1);

    const [oppRow] = await db
      .select()
      .from(marketOpportunityScores)
      .where(eq(marketOpportunityScores.geographyId, g.id))
      .orderBy(desc(marketOpportunityScores.snapshotDate))
      .limit(1);

    if (!healthRow && !oppRow) {
      result.marketsSkipped++;
      continue;
    }

    const snapshotDate =
      toYmd(healthRow?.snapshotDate) ??
      toYmd(oppRow?.snapshotDate) ??
      new Date().toISOString().slice(0, 10);

    // Skip if we already have a narrative for this exact snapshot_date.
    // Makes the pipeline idempotent + self-resuming: a 504-timed-out run
    // can be re-dispatched and picks up from where it left off instead
    // of re-burning OpenAI spend on markets already done.
    const [existing] = await db
      .select({ id: marketNarratives.id })
      .from(marketNarratives)
      .where(
        and(
          eq(marketNarratives.geographyId, g.id),
          eq(marketNarratives.snapshotDate, snapshotDate)
        )
      )
      .limit(1);
    if (existing) {
      result.marketsSkipped++;
      continue;
    }

    const builderRows = await db
      .select({ ticker: opsBuilderMarkets.builderTicker })
      .from(opsBuilderMarkets)
      .where(eq(opsBuilderMarkets.geographyId, g.id));
    const tickers = builderRows.map((r) => r.ticker).sort();

    const financial = healthRow ? toNumber(healthRow.financialScore) : null;
    const demand = healthRow ? toNumber(healthRow.demandScore) : null;
    const operational = healthRow ? toNumber(healthRow.operationalScore) : null;

    const portfolioInputs: PortfolioHealthInputs = {
      shortName: g.shortName,
      state: g.state,
      financial,
      demand,
      operational,
    };
    const opportunityInputs: MarketOpportunityBlurbInputs = {
      shortName: g.shortName,
      state: g.state,
      numGreen: oppRow?.numGreen ?? 0,
      filter1Migration: oppRow ? toNumber(oppRow.filter1Migration) : null,
      filter2Diversity: oppRow ? toNumber(oppRow.filter2Diversity) : null,
      filter3Imbalance: oppRow ? toNumber(oppRow.filter3Imbalance) : null,
      filter4Competition: oppRow ? toNumber(oppRow.filter4Competitive) : null,
      filter5Affordability: oppRow ? toNumber(oppRow.filter5Affordability) : null,
      filter6Operational: oppRow ? toNumber(oppRow.filter6Operational) : null,
      publicBuilderTickers: tickers,
    };

    try {
      const narratives = await generateMarketNarratives(
        client,
        portfolioInputs,
        opportunityInputs
      );

      await db
        .insert(marketNarratives)
        .values({
          id: randomUUID(),
          geographyId: g.id,
          snapshotDate,
          portfolioHealthBlurb: narratives.portfolioHealth || null,
          marketOpportunityBlurb: narratives.marketOpportunity || null,
          model: "gpt-4.1",
        })
        .onConflictDoUpdate({
          target: [marketNarratives.geographyId, marketNarratives.snapshotDate],
          set: {
            portfolioHealthBlurb: narratives.portfolioHealth || null,
            marketOpportunityBlurb: narratives.marketOpportunity || null,
            generatedAt: new Date(),
          },
        });
      result.marketsGenerated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${g.shortName}/${g.state}: ${msg}`);
    }
  }

  result.durationMs = Date.now() - startedAt;
  console.log(
    `[market-narratives] Done: ${result.marketsGenerated}/${result.marketsProcessed} markets in ${(result.durationMs / 1000).toFixed(0)}s, ${result.errors.length} errors`
  );
  return result;
}
