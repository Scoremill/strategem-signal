/**
 * Capacity-level AI narrative — translates raw trade capacity data
 * into operational builder implications per market.
 */
import OpenAI from "openai";

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey });
}

interface CapacityMarket {
  name: string;
  state: string;
  tradeWorkers: number;
  establishments: number;
  avgWeeklyWage: number;
  wageGrowthYoy: number;
  ratio: number;
  status: string;
  permits: number | null;
}

export interface BuilderImplication {
  market: string;
  implication: string;  // 2-3 sentence operational guidance
  tradePricing: "leverage" | "market" | "premium";  // builder's negotiating position
  cycleTimeRisk: "low" | "moderate" | "high";
}

const SYSTEM_PROMPT = `You are an operational advisor for homebuilding executives analyzing trade contractor capacity.

For each market, provide a concise builder implication — what does this capacity data mean for a builder planning to start communities here? Focus on:
- Trade contract pricing: Does the builder have leverage (surplus capacity), or will they pay premium (constrained)?
- Cycle time risk: Will trades be available when needed, or will the builder face scheduling delays?
- Market concentration: If few establishments serve many workers, one firm has outsized power.
- Actionable advice: Should they lock trade contracts early? Budget for cost escalation? Plan for extended schedules?

Be specific and practical. A VP of Construction needs to know what to budget and how to plan.`;

export async function generateBuilderImplications(
  markets: CapacityMarket[]
): Promise<BuilderImplication[]> {
  const client = getClient();

  const marketLines = markets
    .map((m) => {
      const statusLabel = m.status === "constrained" ? "CONSTRAINED" : m.status === "equilibrium" ? "BALANCED" : "FAVORABLE";
      const workersPerEstab = m.establishments > 0 ? Math.round(m.tradeWorkers / m.establishments) : 0;
      return `${m.name}, ${m.state}: ${m.tradeWorkers.toLocaleString()} trade workers, ${m.establishments.toLocaleString()} establishments (${workersPerEstab} workers/firm), $${m.avgWeeklyWage}/wk avg wage, ${m.wageGrowthYoy}% wage growth YoY, D/C Ratio ${m.ratio.toFixed(2)} (${statusLabel}), ${m.permits?.toLocaleString() ?? "N/A"} permits/mo`;
    })
    .join("\n");

  const userPrompt = `Analyze these ${markets.length} markets and provide builder operational implications.

${marketLines}

Return a JSON object with "implications": an array of objects, one per market, each with:
- "market": city name
- "implication": 2-3 sentence operational guidance for a VP of Construction or Purchasing
- "tradePricing": "leverage" (builder has pricing power), "market" (fair market pricing), or "premium" (expect to pay above market)
- "cycleTimeRisk": "low", "moderate", or "high"

Return ONLY valid JSON.`;

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
    if (!content) return [];

    const parsed = JSON.parse(content);
    return parsed.implications || [];
  } catch (err) {
    console.error("[capacity-narrative] Failed:", err);
    return [];
  }
}
