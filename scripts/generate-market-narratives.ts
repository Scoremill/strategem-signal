/**
 * Generate market narratives for every market at the latest snapshot
 * date. One-off script for the initial run; the ongoing refresh is
 * wired into the portfolio-health cron.
 */
import { db } from "../src/lib/db";
import {
  geographies,
  portfolioHealthSnapshots,
  marketOpportunityScores,
  opsBuilderMarkets,
  marketNarratives,
} from "../src/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import OpenAI from "openai";
import {
  generateMarketNarratives,
  type PortfolioHealthInputs,
  type MarketOpportunityBlurbInputs,
} from "../src/lib/narrative/market-narrative";

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

async function main() {
  const startedAt = Date.now();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const client = new OpenAI({ apiKey });

  const geos = await db.select().from(geographies).where(eq(geographies.isActive, true));
  console.log(`[generate-narratives] ${geos.length} active markets`);

  let generated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const g of geos) {
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
      skipped++;
      continue;
    }

    const snapshotDate =
      toYmd(healthRow?.snapshotDate) ??
      toYmd(oppRow?.snapshotDate) ??
      new Date().toISOString().slice(0, 10);

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
      generated++;
      if (generated % 20 === 0) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(`  ${generated}/${geos.length}, elapsed ${elapsed}s`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${g.shortName}/${g.state}: ${msg}`);
      console.warn(`  ✗ ${g.shortName}, ${g.state}: ${msg}`);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n[generate-narratives] Done in ${elapsed}s`);
  console.log(`  Generated: ${generated}`);
  console.log(`  Skipped (no snapshots): ${skipped}`);
  console.log(`  Errors: ${errors.length}`);
  if (errors.length > 0) {
    console.log("  First 5 errors:");
    for (const e of errors.slice(0, 5)) console.log(`    ${e}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
