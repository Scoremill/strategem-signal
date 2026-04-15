/**
 * Market narrative generator.
 *
 * Produces two short plain-English blurbs for a market — one that
 * narrates the Portfolio Health composite + sub-scores, one that
 * narrates the six-filter Market Opportunity read. Strictly
 * descriptive: the prompt forbids recommendations, forbids
 * editorializing, forbids predictive claims. The blurb says "X
 * scores Y because Z" and stops.
 *
 * CEO-defensibility is the point. The blurb is summarizing the
 * data the CEO already has in front of them; it's not picking a
 * direction for them. That distinction has to survive a board
 * meeting.
 *
 * Model: gpt-4.1 (same as the Filter 4 parser — we've already
 * paid for the better model; use it for everything user-facing).
 */
import OpenAI from "openai";

export interface PortfolioHealthInputs {
  shortName: string;
  state: string;
  composite: number | null;
  financial: number | null;
  demand: number | null;
  operational: number | null;
  weightingPreset: string;
}

export interface MarketOpportunityBlurbInputs {
  shortName: string;
  state: string;
  numGreen: number;
  filter1Migration: number | null;
  filter2Diversity: number | null;
  filter3Imbalance: number | null;
  filter4Competition: number | null;
  filter5Affordability: number | null;
  filter6Operational: number | null;
  publicBuilderTickers: string[];
}

export interface GeneratedNarratives {
  portfolioHealth: string;
  marketOpportunity: string;
}

const SYSTEM_PROMPT = `You write one-paragraph summaries of US homebuilding market data for a CEO audience. You are narrating the numbers, not making decisions.

Hard rules:
- 2-3 sentences maximum per blurb. No more.
- Describe what the scores ARE, never what the CEO should DO. Forbidden words: "should", "recommend", "advise", "suggest", "consider", "opportunity for you", "we think", "promising", "attractive", "great", "best", "worst".
- No predictions. Forbidden phrases: "will grow", "expected to", "likely to", "future", "forecast".
- Use plain English a non-technical reader gets on one pass. No jargon, no index names, no formula names.
- Lead with the headline number, then the supporting inputs that drove it. "The composite is X. That reflects [high/low] Financial at Y because incomes are rising, and [high/low] Demand at Z because permits are up/down N%."
- When a score is notably high or low, say WHY in plain terms (e.g. "affordability is strong because incomes are outrunning home prices", not "affordability runway trajectory is positive").
- When multiple scores pull in opposite directions, name the tension factually. "Demand is strong but operational is tight."
- Never invent data not in the inputs. If a sub-score is null, say "data is pending" or omit it entirely.
- Stay neutral. You're a wire-service reporter, not a pitchman.

Your output must be valid JSON with exactly two keys: portfolioHealth (string) and marketOpportunity (string).`;

function describePortfolioHealthInputs(i: PortfolioHealthInputs): string {
  const parts: string[] = [];
  parts.push(`Market: ${i.shortName}, ${i.state}`);
  parts.push(`Weighting preset: ${i.weightingPreset}`);
  parts.push(`Composite score: ${i.composite != null ? i.composite.toFixed(0) : "null"} out of 100`);
  parts.push(`Financial sub-score (buying power / income growth): ${i.financial != null ? i.financial.toFixed(0) : "null"}`);
  parts.push(`Demand sub-score (permits, jobs, migration, unemployment): ${i.demand != null ? i.demand.toFixed(0) : "null"}`);
  parts.push(`Operational sub-score (trade wages, construction labor availability): ${i.operational != null ? i.operational.toFixed(0) : "null"}`);
  return parts.join("\n");
}

function describeOpportunityInputs(i: MarketOpportunityBlurbInputs): string {
  const parts: string[] = [];
  parts.push(`Market: ${i.shortName}, ${i.state}`);
  parts.push(`Filters passed (score >= 60): ${i.numGreen} of 6`);
  parts.push(`Filter 1 — Migration Tailwinds (people moving in): ${i.filter1Migration != null ? i.filter1Migration.toFixed(0) : "null"}`);
  parts.push(`Filter 2 — Employment Diversity (economy spread across many industries): ${i.filter2Diversity != null ? i.filter2Diversity.toFixed(0) : "null"}`);
  parts.push(`Filter 3 — Supply-Demand Imbalance (demand outrunning supply): ${i.filter3Imbalance != null ? i.filter3Imbalance.toFixed(0) : "null"}`);
  parts.push(`Filter 4 — Competitive Landscape (public builders operating in market, inverted so higher = less crowded): ${i.filter4Competition != null ? i.filter4Competition.toFixed(0) : "null"}`);
  if (i.publicBuilderTickers.length > 0) {
    parts.push(`  Builders known to operate here: ${i.publicBuilderTickers.join(", ")} (${i.publicBuilderTickers.length} total)`);
  }
  parts.push(`Filter 5 — Affordability Runway (incomes outrunning home prices): ${i.filter5Affordability != null ? i.filter5Affordability.toFixed(0) : "null"}`);
  parts.push(`Filter 6 — Operational Feasibility (trade labor stable, wages not spiking): ${i.filter6Operational != null ? i.filter6Operational.toFixed(0) : "null"}`);
  return parts.join("\n");
}

/**
 * Generate both narratives for a market in one LLM call. Returns
 * the raw strings ready to insert into market_narratives.
 *
 * Caller is responsible for handling rate limits and retries. The
 * function is pure (no DB access) so it's trivially testable.
 */
export async function generateMarketNarratives(
  client: OpenAI,
  portfolioInputs: PortfolioHealthInputs,
  opportunityInputs: MarketOpportunityBlurbInputs
): Promise<GeneratedNarratives> {
  const userPrompt = `You are producing TWO narratives for the same market.

=== INPUTS FOR PORTFOLIO HEALTH NARRATIVE ===
${describePortfolioHealthInputs(portfolioInputs)}

=== INPUTS FOR MARKET OPPORTUNITY NARRATIVE ===
${describeOpportunityInputs(opportunityInputs)}

Respond with JSON: {"portfolioHealth": "...", "marketOpportunity": "..."}`;

  const res = await client.chat.completions.create({
    model: "gpt-4.1",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3, // low but not zero — we want some naturalness in phrasing
  });
  const content = res.choices[0]?.message?.content;
  if (!content) {
    return { portfolioHealth: "", marketOpportunity: "" };
  }
  try {
    const parsed = JSON.parse(content) as Partial<GeneratedNarratives>;
    return {
      portfolioHealth: typeof parsed.portfolioHealth === "string" ? parsed.portfolioHealth : "",
      marketOpportunity: typeof parsed.marketOpportunity === "string" ? parsed.marketOpportunity : "",
    };
  } catch {
    return { portfolioHealth: "", marketOpportunity: "" };
  }
}
