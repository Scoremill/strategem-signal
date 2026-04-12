/**
 * OpenAI-powered market narrative generator for StrategemSignal.
 * Generates two versions:
 * 1. Full narrative (3-4 sentences) for the MSA deep dive page
 * 2. Snippet (1-2 sentences) for the heatmap popup
 */
import OpenAI from "openai";

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey });
}

interface MarketData {
  name: string;
  state: string;
  demandIndex: number;
  capacityIndex: number;
  ratio: number;
  status: string;
  permits: number | null;
  employment: number | null;
  unemploymentRate: number | null;
  tradeWorkers: number | null;
  wageGrowthYoy: number | null;
  establishments: number | null;
}

export interface MarketNarrative {
  full: string;    // 3-4 sentences for MSA detail page
  snippet: string; // 1-2 sentences for heatmap popup
}

const SYSTEM_PROMPT = `You are a market intelligence analyst for StrategemSignal, a platform that helps homebuilding executives understand the demand-capacity dynamics of residential construction markets.

You write concise, data-driven market assessments in a professional tone. Your audience is CEOs, division presidents, and VPs at major homebuilders. They care about:
- Whether a market can support additional starts
- Trade labor availability and cost pressure
- The balance between housing demand and construction capacity

Use specific numbers from the data provided. Do not speculate beyond the data. Do not use bullet points. Write in complete paragraphs.

The Demand-Capacity Ratio is the key metric:
- Above 1.15 = Constrained: demand exceeds trade capacity, expect longer cycle times and cost pressure
- 0.85 to 1.15 = Balanced: demand and capacity in equilibrium
- Below 0.85 = Favorable: capacity available for expansion, trade pricing leverage for builders

When analyzing the data, note these market-specific factors:
- If trade worker count is high but establishment count is low, flag potential market concentration (a few large firms dominating). This affects builder negotiating leverage.
- If wage growth exceeds 5% YoY, call out specific cost pressure implications for builder margins.
- If unemployment is very low (under 3.5%), note that the tight labor market extends beyond construction trades.
- Compare permits-to-workers ratio implicitly — high permits with low trade workers = cycle time risk.`;

export async function generateMarketNarrative(
  market: MarketData
): Promise<MarketNarrative> {
  const client = getClient();

  const statusLabel =
    market.status === "constrained"
      ? "Constrained"
      : market.status === "equilibrium"
        ? "Balanced"
        : "Favorable";

  const userPrompt = `Generate a market intelligence assessment for ${market.name}, ${market.state}.

Data:
- Demand Index: ${market.demandIndex}/100
- Capacity Index: ${market.capacityIndex}/100
- Demand-Capacity Ratio: ${market.ratio.toFixed(2)} (${statusLabel})
- Monthly Building Permits: ${market.permits?.toLocaleString() ?? "N/A"}
- Total Nonfarm Employment: ${market.employment ? (market.employment >= 1_000_000 ? (market.employment / 1_000_000).toFixed(2) + "M" : (market.employment / 1000).toFixed(0) + "K") : "N/A"}
- Unemployment Rate: ${market.unemploymentRate ? market.unemploymentRate + "%" : "N/A"}
- Trade Construction Workers: ${market.tradeWorkers?.toLocaleString() ?? "N/A"}
- Trade Wage Growth (YoY): ${market.wageGrowthYoy ? market.wageGrowthYoy + "%" : "N/A"}
- Trade Contractor Establishments: ${market.establishments?.toLocaleString() ?? "N/A"}

Return a JSON object with two fields:
- "full": A 3-4 sentence market assessment for the detailed market page. Lead with the demand-capacity conclusion, then support with specific data points. End with an implication for builder strategy.
- "snippet": A 1-2 sentence summary suitable for a map popup tooltip. Focus on the key takeaway — is this a good market to deploy capital into right now?

Return ONLY valid JSON. No markdown.`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response from OpenAI");

    const parsed = JSON.parse(content);
    return {
      full: parsed.full || "",
      snippet: parsed.snippet || "",
    };
  } catch (err) {
    console.error(`[narrative] Failed for ${market.name}:`, err);
    return {
      full: "",
      snippet: "",
    };
  }
}
