/**
 * Parse public-builder earnings narratives to extract per-market
 * mentions and resolve them to CBSA geographies. Populates
 * ops_builder_markets which feeds Phase 2 Filter 4 (Competitive
 * Landscape) and the Phase 3 acquisition entry model.
 *
 * Strategy:
 *   1. Loop every narrative row in ops_management_narratives
 *   2. For each row, send the first ~15k chars of full_text to
 *      gpt-4.1 with a structured-output response format that forces
 *      {markets: [{name, state, confidence}]}
 *   3. For each extracted market, fuzzy-match against the 199 rows
 *      in geographies (short_name, name, state)
 *   4. Upsert into ops_builder_markets keyed by (builder_ticker,
 *      geography_id) — mention_count increments, source_ids array
 *      appends, first_seen_year / last_seen_year track window
 *   5. Unresolved market names get logged but not stored
 *
 * Cost estimate (Apr 2026 pricing): 520 narratives × ~4k input
 * tokens × $2.00/1M = ~$4. Well under the $10 ceiling I quoted Drew.
 * Runtime estimate: ~2-3s per call × 520 = ~15-20 min.
 *
 * Resumable: the upsert is idempotent; re-running from scratch would
 * just refresh counts. For efficiency the script has a --resume flag
 * that skips narratives already tagged in a local progress file.
 */
import { db } from "../src/lib/db";
import {
  geographies,
  opsManagementNarratives,
  opsCompanies,
  opsBuilderMarkets,
} from "../src/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import OpenAI from "openai";
import { readFileSync, writeFileSync, existsSync } from "fs";

const PROGRESS_FILE = "/tmp/ops-builder-markets-progress.json";
const MODEL = "gpt-4.1";
const MAX_CHARS_PER_CALL = 15000;

interface ExtractedMarket {
  name: string; // raw name as written, e.g. "Dallas-Fort Worth" or "Phoenix"
  state: string; // 2-letter abbreviation, e.g. "TX"
  confidence: "high" | "medium" | "low";
}

interface ExtractionResult {
  markets: ExtractedMarket[];
}

const SYSTEM_PROMPT = `You are analyzing earnings-call transcripts from publicly-traded US homebuilders. Your job is to extract the list of US metropolitan markets (cities, metros, MSAs) where the builder currently operates or has active building communities.

Rules:
- Only include markets that the builder explicitly operates in or has current projects in. Do NOT include markets mentioned only in passing references (e.g. "the national market"), markets they have exited, markets where a competitor operates, or markets mentioned in macro commentary.
- "high" confidence: the builder explicitly names the market as theirs ("our Phoenix operations", "we opened communities in Raleigh this quarter")
- "medium" confidence: the builder names the market as part of a regional breakdown or portfolio list, but not explicitly as an operation ("Texas, Florida, and the Carolinas")
- "low" confidence: implied from context only ("our Southwest division" → suggests AZ/NV/NM but don't guess)
- Use the proper city name, not submarkets or project names (prefer "Dallas" over "Frisco" or "Plano")
- State codes are US 2-letter: TX, FL, CA, etc.
- Return an empty markets array if the transcript is purely national financial summary with no geographic detail.

Respond with JSON matching: {"markets": [{"name": "Dallas", "state": "TX", "confidence": "high"}, ...]}`;

async function extractMarkets(
  client: OpenAI,
  ticker: string,
  companyName: string,
  fiscalYear: number,
  fiscalQuarter: number,
  text: string
): Promise<ExtractionResult> {
  const snippet = text.slice(0, MAX_CHARS_PER_CALL);
  const userPrompt = `Builder: ${companyName} (${ticker})
Fiscal period: FY${fiscalYear} Q${fiscalQuarter}

Transcript:
${snippet}`;

  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.0,
  });
  const content = res.choices[0]?.message?.content;
  if (!content) return { markets: [] };
  try {
    const parsed = JSON.parse(content) as ExtractionResult;
    if (!Array.isArray(parsed.markets)) return { markets: [] };
    return parsed;
  } catch {
    return { markets: [] };
  }
}

/**
 * Fuzzy-resolve an extracted market name + state to a geography row.
 * Strategy:
 *   1. Exact short_name + state match
 *   2. Case-insensitive substring match on short_name (first token)
 *   3. Substring match on the full name (which includes hyphenated
 *      secondary cities)
 *   4. State-only fallback is NOT done — too imprecise
 */
function resolveMarket(
  name: string,
  state: string,
  geos: Array<{ id: string; shortName: string; name: string; state: string }>
): string | null {
  const nameLower = name.toLowerCase().trim();
  const stateUpper = state.toUpperCase().trim();
  // Exact short_name + state match
  for (const g of geos) {
    if (g.state === stateUpper && g.shortName.toLowerCase() === nameLower) {
      return g.id;
    }
  }
  // First-token match: "Dallas" against "Dallas-Fort Worth"
  for (const g of geos) {
    if (g.state !== stateUpper) continue;
    const firstToken = g.shortName.split("-")[0].toLowerCase();
    if (firstToken === nameLower) return g.id;
  }
  // Substring match on full CBSA name (covers "Fort Worth" → Dallas-Fort Worth)
  for (const g of geos) {
    if (g.state !== stateUpper) continue;
    if (g.name.toLowerCase().includes(nameLower)) return g.id;
  }
  // Reverse substring — extracted name contains the short_name
  for (const g of geos) {
    if (g.state !== stateUpper) continue;
    if (nameLower.includes(g.shortName.toLowerCase())) return g.id;
  }
  return null;
}

interface Progress {
  processedNarrativeIds: number[];
  builderMarketCounts: Record<string, Record<string, {
    count: number;
    sources: number[];
    firstYear: number;
    lastYear: number;
    confidence: "high" | "medium" | "low";
  }>>;
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
  }
  return { processedNarrativeIds: [], builderMarketCounts: {} };
}

function saveProgress(p: Progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

async function main() {
  const startedAt = Date.now();
  const resume = process.argv.includes("--resume");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const client = new OpenAI({ apiKey });

  // Load all narratives that have text
  const narratives = await db
    .select({
      id: opsManagementNarratives.id,
      companyId: opsManagementNarratives.companyId,
      fiscalYear: opsManagementNarratives.fiscalYear,
      fiscalQuarter: opsManagementNarratives.fiscalQuarter,
      fullText: opsManagementNarratives.fullText,
      preparedRemarksText: opsManagementNarratives.preparedRemarksText,
    })
    .from(opsManagementNarratives);

  // Company lookup
  const companies = await db
    .select({
      id: opsCompanies.id,
      ticker: opsCompanies.ticker,
      companyName: opsCompanies.companyName,
    })
    .from(opsCompanies);
  const companyById = new Map(companies.map((c) => [c.id, c]));

  // Geographies lookup
  const geos = await db
    .select({
      id: geographies.id,
      shortName: geographies.shortName,
      name: geographies.name,
      state: geographies.state,
    })
    .from(geographies)
    .where(eq(geographies.isActive, true));

  // Progress tracking
  const progress = resume ? loadProgress() : { processedNarrativeIds: [], builderMarketCounts: {} };
  const processed = new Set(progress.processedNarrativeIds);

  const toProcess = narratives.filter((n) => {
    if (processed.has(n.id)) return false;
    const text = n.fullText || n.preparedRemarksText || "";
    return text.length > 500;
  });

  console.log(`[parse-builder-markets] ${narratives.length} total narratives`);
  console.log(`  ${toProcess.length} to process (skipped ${narratives.length - toProcess.length})`);
  console.log(`  ${companies.length} builders, ${geos.length} geographies`);
  console.log(`  Model: ${MODEL}, max chars per call: ${MAX_CHARS_PER_CALL}`);

  let idx = 0;
  let totalExtracted = 0;
  let totalResolved = 0;
  let totalUnresolved = 0;
  const unresolvedSamples: string[] = [];

  for (const n of toProcess) {
    idx++;
    const company = companyById.get(n.companyId);
    if (!company) continue;
    const text = n.fullText || n.preparedRemarksText || "";

    try {
      const result = await extractMarkets(
        client,
        company.ticker,
        company.companyName,
        n.fiscalYear,
        n.fiscalQuarter,
        text
      );
      totalExtracted += result.markets.length;

      const bucket = progress.builderMarketCounts[company.ticker] ?? {};
      progress.builderMarketCounts[company.ticker] = bucket;

      for (const m of result.markets) {
        const geoId = resolveMarket(m.name, m.state, geos);
        if (!geoId) {
          totalUnresolved++;
          if (unresolvedSamples.length < 20) {
            unresolvedSamples.push(`${m.name}, ${m.state} (${company.ticker})`);
          }
          continue;
        }
        totalResolved++;
        const entry = bucket[geoId] ?? {
          count: 0,
          sources: [],
          firstYear: n.fiscalYear,
          lastYear: n.fiscalYear,
          confidence: m.confidence,
        };
        entry.count++;
        if (!entry.sources.includes(n.id)) entry.sources.push(n.id);
        if (n.fiscalYear < entry.firstYear) entry.firstYear = n.fiscalYear;
        if (n.fiscalYear > entry.lastYear) entry.lastYear = n.fiscalYear;
        // Upgrade confidence if a later mention is stronger
        if (m.confidence === "high" || (m.confidence === "medium" && entry.confidence === "low")) {
          entry.confidence = m.confidence;
        }
        bucket[geoId] = entry;
      }
      progress.processedNarrativeIds.push(n.id);

      if (idx % 10 === 0) {
        saveProgress(progress);
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(`  ${idx}/${toProcess.length}: extracted ${totalExtracted}, resolved ${totalResolved}, unresolved ${totalUnresolved}, elapsed ${elapsed}s`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ✗ ${company.ticker} FY${n.fiscalYear}Q${n.fiscalQuarter}: ${msg}`);
    }
  }
  saveProgress(progress);

  console.log("\n[parse-builder-markets] Extraction done. Writing to DB...");

  // Flush progress.builderMarketCounts to ops_builder_markets table
  // Strategy: delete all existing rows, re-insert from aggregate.
  // Simpler than upserting one at a time given the bucket structure.
  await db.delete(opsBuilderMarkets);

  let rowsWritten = 0;
  for (const [ticker, byGeo] of Object.entries(progress.builderMarketCounts)) {
    for (const [geoId, entry] of Object.entries(byGeo)) {
      await db
        .insert(opsBuilderMarkets)
        .values({
          id: randomUUID(),
          builderTicker: ticker,
          geographyId: geoId,
          mentionCount: entry.count,
          firstSeenYear: entry.firstYear,
          lastSeenYear: entry.lastYear,
          sourceIds: entry.sources,
          confidence: entry.confidence,
        })
        .onConflictDoNothing();
      rowsWritten++;
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n[parse-builder-markets] Done in ${elapsed}s`);
  console.log(`  Narratives processed: ${idx}`);
  console.log(`  Markets extracted (raw): ${totalExtracted}`);
  console.log(`  Resolved to CBSA: ${totalResolved}`);
  console.log(`  Unresolved: ${totalUnresolved}`);
  console.log(`  Rows written to ops_builder_markets: ${rowsWritten}`);
  if (unresolvedSamples.length > 0) {
    console.log(`\n  Unresolved samples:`);
    for (const s of unresolvedSamples) console.log(`    ${s}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
