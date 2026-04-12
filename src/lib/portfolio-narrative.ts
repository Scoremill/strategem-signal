/**
 * Portfolio-level AI narrative — synthesizes all monitored markets into
 * a single actionable intelligence summary for the dashboard.
 */
import OpenAI from "openai";

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey });
}

interface MarketSummary {
  name: string;
  state: string;
  demandIndex: number;
  capacityIndex: number;
  ratio: number;
  status: string;
  permits: number | null;
  tradeWorkers: number | null;
  wageGrowthYoy: number | null;
  establishments: number | null;
  unemploymentRate: number | null;
}

const SYSTEM_PROMPT = `You are a strategic market intelligence advisor for homebuilding executives. You analyze a portfolio of MSA markets and provide actionable capital deployment recommendations.

Your audience is a CEO or COO deciding where to invest in land, start new communities, acquire divisions, or grow organically. They need to know:
1. Which markets to PURSUE — favorable demand-capacity dynamics for profitable growth
2. Which markets to HOLD — balanced but requires monitoring
3. Which markets to AVOID or MODERATE — constrained capacity will eat margins

Write in a direct, executive tone. Lead with the conclusion, support with data. No bullet points in the main narrative — write in connected paragraphs. Use specific market names and numbers.

Key context:
- D/C Ratio > 1.15 = Constrained (demand exceeds trade capacity)
- D/C Ratio 0.85-1.15 = Balanced
- D/C Ratio < 0.85 = Favorable (capacity available for builder expansion)
- High wage growth (>5% YoY) signals trade cost escalation regardless of ratio
- Low establishment counts relative to workers signals market concentration risk
- The builder wants to deploy capital where demand is strong AND capacity can support additional volume without destroying margins`;

export interface PortfolioNarrative {
  summary: string;       // 4-6 sentence executive overview
  topPicks: Array<{      // top 10 markets for capital deployment
    market: string;
    reason: string;      // 1-2 sentence rationale
    ratio: number;
    caution: string;     // what to watch out for
  }>;
  watchList: Array<{     // top 10 markets with emerging risk
    market: string;
    concern: string;
  }>;
}

export async function generatePortfolioNarrative(
  markets: MarketSummary[]
): Promise<PortfolioNarrative> {
  const client = getClient();

  const marketLines = markets
    .sort((a, b) => a.ratio - b.ratio) // favorable first
    .map((m) => {
      const statusLabel = m.status === "constrained" ? "CONSTRAINED" : m.status === "equilibrium" ? "BALANCED" : "FAVORABLE";
      return `${m.name}, ${m.state}: D/C Ratio ${m.ratio.toFixed(2)} (${statusLabel}), Demand ${m.demandIndex}, Capacity ${m.capacityIndex}, Permits/mo ${m.permits?.toLocaleString() ?? "N/A"}, Trade Workers ${m.tradeWorkers?.toLocaleString() ?? "N/A"}, Wage Growth ${m.wageGrowthYoy ?? "N/A"}% YoY, Establishments ${m.establishments?.toLocaleString() ?? "N/A"}, Unemployment ${m.unemploymentRate ?? "N/A"}%`;
    })
    .join("\n");

  const userPrompt = `Analyze this portfolio of ${markets.length} MSA markets and provide capital deployment intelligence.

MARKET DATA:
${marketLines}

Return a JSON object with:
- "summary": A 4-6 sentence executive overview. Start with how many markets are favorable vs constrained. Identify the top 2-3 markets for capital deployment and why. Call out the biggest risk in the portfolio. End with an overall portfolio posture recommendation.
- "topPicks": Array of EXACTLY 10 objects, ranked from best to worst opportunity for capital deployment. Each object has "market" (city name), "reason" (1-2 sentence rationale for why this is a top pick — reference specific data), "ratio" (the D/C ratio number), and "caution" (1 sentence on what could change or what to monitor). Pull from FAVORABLE and BALANCED markets. If fewer than 10 favorable markets exist, fill the remainder with the strongest BALANCED markets.
- "watchList": Array of EXACTLY 10 objects, ranked from highest risk to lowest, each with "market" and "concern" — markets where capacity is most stressed relative to demand. Focus on CONSTRAINED markets first, then BALANCED markets with high wage growth or other stress signals. If fewer than 10 constrained markets exist, fill the remainder with stressed balanced markets.

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
      summary: parsed.summary || "",
      topPicks: parsed.topPicks || [],
      watchList: parsed.watchList || [],
    };
  } catch (err) {
    console.error("[portfolio-narrative] Failed:", err);
    return { summary: "", topPicks: [], watchList: [] };
  }
}
