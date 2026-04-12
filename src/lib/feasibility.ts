/**
 * Community Feasibility Engine
 *
 * Takes a proposed community (lots, starts pace) and stress-tests it
 * against the current market demand-capacity dynamics to produce a
 * go/no-go recommendation with specific risk metrics.
 */
import OpenAI from "openai";

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  return new OpenAI({ apiKey });
}

export interface FeasibilityInput {
  marketName: string;
  marketState: string;
  totalLots: number;
  startsPerMonth: number;
  // Market data
  estMonthlyStarts: number;
  tradeWorkers: number;
  tradeAvailability: number;
  wageGrowthYoy: number;
  demandCapacityRatio: number;
  status: string;
  demandIndex: number;
  capacityIndex: number;
  establishments: number;
}

export interface FeasibilityResult {
  marketShare: number;           // % of total market starts
  laborAbsorption: number;       // % of available trade capacity consumed
  tradeWorkersNeeded: number;    // estimated workers needed to support pace
  cycleTimeRiskFactor: number;   // multiplier for baseline cycle time
  costEscalationEstimate: number; // expected trade cost escalation % over lifecycle
  absorptionMonths: number;      // months to build all lots at target pace
  goNoGo: "green" | "yellow" | "red";
  confidence: "high" | "medium" | "low";
  summary: string;               // AI-generated executive summary
  risks: string[];               // specific risks
  recommendations: string[];     // specific actions
}

/**
 * Compute quantitative feasibility metrics (no AI required).
 */
export function computeFeasibility(input: FeasibilityInput): Omit<FeasibilityResult, "summary" | "risks" | "recommendations"> {
  // Market share: your starts as % of estimated total market starts
  const marketShare = input.estMonthlyStarts > 0
    ? (input.startsPerMonth / input.estMonthlyStarts) * 100
    : 0;

  // Trade workers needed — rough industry rule: ~30 trade workers per home per month
  // at standard cycle (varies by product type; this is SF mid-market assumption)
  const tradeWorkersNeeded = Math.round(input.startsPerMonth * 30);

  // Labor absorption: workers needed vs. available (approximated from tradeAvailability × permits)
  const availableWorkers = Math.round(input.tradeAvailability * input.startsPerMonth);
  const laborAbsorption = availableWorkers > 0
    ? (tradeWorkersNeeded / availableWorkers) * 100
    : 100;

  // Cycle time risk — markets at higher D/C ratio stretch cycle times more
  // Empirical: every 0.1 above 1.0 adds ~4% to cycle time in constrained markets
  let cycleTimeRiskFactor = 1.0;
  if (input.demandCapacityRatio > 1.0) {
    cycleTimeRiskFactor = 1.0 + ((input.demandCapacityRatio - 1.0) * 0.4);
  }

  // Cost escalation — function of wage growth compounded over absorption period
  const absorptionMonths = Math.ceil(input.totalLots / input.startsPerMonth);
  const absorptionYears = absorptionMonths / 12;
  // Expected cost escalation = current wage growth rate × years, but dampened by labor absorption
  const costEscalationEstimate = input.wageGrowthYoy * absorptionYears * (1 + (laborAbsorption / 100) * 0.5);

  // Go/no-go logic
  let goNoGo: "green" | "yellow" | "red";
  if (input.demandCapacityRatio > 1.5 || laborAbsorption > 80 || input.wageGrowthYoy > 7) {
    goNoGo = "red";
  } else if (input.demandCapacityRatio > 1.15 || laborAbsorption > 50 || input.wageGrowthYoy > 5) {
    goNoGo = "yellow";
  } else {
    goNoGo = "green";
  }

  // Confidence: higher when input data is complete
  const confidence: "high" | "medium" | "low" =
    input.tradeWorkers > 0 && input.wageGrowthYoy !== null ? "high" : "medium";

  return {
    marketShare: Math.round(marketShare * 10) / 10,
    laborAbsorption: Math.round(laborAbsorption * 10) / 10,
    tradeWorkersNeeded,
    cycleTimeRiskFactor: Math.round(cycleTimeRiskFactor * 100) / 100,
    costEscalationEstimate: Math.round(costEscalationEstimate * 10) / 10,
    absorptionMonths,
    goNoGo,
    confidence,
  };
}

const SYSTEM_PROMPT = `You are a homebuilder feasibility analyst. You assess whether a proposed community makes sense in a specific market given current demand-capacity dynamics.

Your output goes into an investment committee memo. Be direct, data-driven, and specific. Call out quantified risks. Provide actionable recommendations the builder can act on.`;

export async function generateFeasibilityNarrative(
  input: FeasibilityInput,
  metrics: Omit<FeasibilityResult, "summary" | "risks" | "recommendations">
): Promise<{ summary: string; risks: string[]; recommendations: string[] }> {
  const client = getClient();

  const userPrompt = `Analyze this community feasibility scenario:

PROPOSED COMMUNITY:
- Market: ${input.marketName}, ${input.marketState}
- Total Lots: ${input.totalLots.toLocaleString()}
- Target Starts/Month: ${input.startsPerMonth}
- Absorption Period: ${metrics.absorptionMonths} months (${(metrics.absorptionMonths / 12).toFixed(1)} years)

MARKET CONDITIONS:
- Demand-Capacity Ratio: ${input.demandCapacityRatio.toFixed(2)} (${input.status})
- Demand Index: ${input.demandIndex}/100
- Capacity Index: ${input.capacityIndex}/100
- Estimated Total Market Starts/Month: ${input.estMonthlyStarts.toLocaleString()}
- Trade Workers: ${input.tradeWorkers.toLocaleString()}
- Trade Availability: ${input.tradeAvailability}
- Wage Growth YoY: ${input.wageGrowthYoy}%
- Trade Contractors: ${input.establishments.toLocaleString()}

COMPUTED METRICS:
- Your market share: ${metrics.marketShare}% of total market starts
- Labor absorption: ${metrics.laborAbsorption}% of available trade capacity
- Trade workers needed: ${metrics.tradeWorkersNeeded.toLocaleString()}
- Cycle time risk factor: ${metrics.cycleTimeRiskFactor}x (${metrics.cycleTimeRiskFactor > 1.2 ? "significant extension expected" : metrics.cycleTimeRiskFactor > 1.0 ? "moderate extension expected" : "no extension expected"})
- Expected cost escalation over lifecycle: ${metrics.costEscalationEstimate}%
- Go/No-Go: ${metrics.goNoGo.toUpperCase()}

Return a JSON object with:
- "summary": 3-4 sentence executive summary. Lead with the go/no-go conclusion. Reference specific numbers. End with the business impact.
- "risks": Array of 2-4 specific risks as strings. Each risk should be concrete and data-backed.
- "recommendations": Array of 2-4 specific actions the builder should take. Each recommendation should be actionable (e.g., "Lock trade contracts within 60 days of closing" not "Watch costs carefully").

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
    if (!content) throw new Error("Empty response");

    const parsed = JSON.parse(content);
    return {
      summary: parsed.summary || "",
      risks: parsed.risks || [],
      recommendations: parsed.recommendations || [],
    };
  } catch (err) {
    console.error("[feasibility] AI narrative failed:", err);
    return {
      summary: "",
      risks: [],
      recommendations: [],
    };
  }
}
