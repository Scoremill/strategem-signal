/**
 * Trade Availability vs Homebuilder Demand — curated quadrant dataset.
 *
 * This is the static research-driven dataset described in the build spec
 * (April 2026). Each market's coordinates are composite scores 0-100 informed
 * by Census Building Permits, BLS QCEW (NAICS 2361/2382), NAHB HMI, RCLCO Top
 * 50 MPC, Builder Magazine Builder 100, BLS OEWS wages, ABC/AGC workforce
 * surveys, HBI labor reports, and regional immigration/aging exposure data.
 *
 * This is a directional strategic framework, not a derived model — see
 * Section 6 of the spec. Dot placements involve judgment calls informed by
 * the cited research and should be refreshed quarterly.
 */

export interface QuadrantMarket {
  name: string;
  state: string;
  demand: number;   // Y-axis: homebuilder demand 0-100
  trades: number;   // X-axis: trade availability 0-100
  rating: "Green" | "Amber" | "Red";
  note: string;
  quadrant: "Top-right" | "Top-left" | "Bottom-right" | "Bottom-left";
}

/**
 * Apply the color rules from spec section 5.5.
 * This is intentionally separate from the static `rating` field so that
 * future tweaks to the rating logic don't require editing every row.
 */
export function computeRating(demand: number, trades: number): "Green" | "Amber" | "Red" {
  const ratio = trades / Math.max(demand, 1);
  if (demand >= 50 && trades >= 50 && ratio >= 0.80) return "Green";
  if (demand >= 55 && trades < 45) return "Red";
  if (demand < 35 && trades < 35) return "Red";
  if (demand < 40 && trades >= 55) return "Green";
  if (ratio >= 0.95) return "Green";
  if (ratio < 0.55) return "Red";
  return "Amber";
}

export const QUADRANT_MARKETS: QuadrantMarket[] = [
  // Top-right — Best markets (high demand, high trades)
  { name: "Houston",            state: "TX", demand: 82, trades: 75, rating: "Green", note: "Deep labor pool, massive builder activity",       quadrant: "Top-right" },
  { name: "Dallas-Fort Worth",  state: "TX", demand: 78, trades: 68, rating: "Green", note: "Strong trade base keeps pace with starts",        quadrant: "Top-right" },
  { name: "San Antonio",        state: "TX", demand: 62, trades: 70, rating: "Green", note: "Solid trades, steady permit growth",              quadrant: "Top-right" },
  { name: "Atlanta",            state: "GA", demand: 70, trades: 63, rating: "Green", note: "Growing demand matched by labor inflow",          quadrant: "Top-right" },
  { name: "Raleigh",            state: "NC", demand: 60, trades: 62, rating: "Green", note: "Tech-driven growth, trades keeping up",           quadrant: "Top-right" },
  { name: "Charlotte",          state: "NC", demand: 65, trades: 58, rating: "Green", note: "Balanced growth corridor",                        quadrant: "Top-right" },
  { name: "Jacksonville",       state: "FL", demand: 58, trades: 55, rating: "Green", note: "Moderate demand, adequate trades",                quadrant: "Top-right" },

  // Top-left — Worst markets (high demand, low trades)
  { name: "Phoenix",            state: "AZ", demand: 85, trades: 38, rating: "Red",   note: "Explosive demand, trades can't keep up",          quadrant: "Top-left" },
  { name: "Austin",             state: "TX", demand: 75, trades: 40, rating: "Red",   note: "Rapid growth overwhelming labor supply",          quadrant: "Top-left" },
  { name: "Nashville",          state: "TN", demand: 72, trades: 35, rating: "Red",   note: "Booming starts, severe trade shortage",           quadrant: "Top-left" },
  { name: "Orlando",            state: "FL", demand: 70, trades: 37, rating: "Red",   note: "High volume, trades stretched thin",              quadrant: "Top-left" },
  { name: "Tampa",              state: "FL", demand: 68, trades: 34, rating: "Red",   note: "Storm recovery + growth = labor crunch",          quadrant: "Top-left" },
  { name: "Miami",              state: "FL", demand: 72, trades: 30, rating: "Red",   note: "High demand, immigration-dependent labor",        quadrant: "Top-left" },
  { name: "Fort Lauderdale",    state: "FL", demand: 68, trades: 32, rating: "Red",   note: "Coastal demand, very tight trades",               quadrant: "Top-left" },
  { name: "Las Vegas",          state: "NV", demand: 65, trades: 33, rating: "Red",   note: "Permit surge, labor pool lagging",                quadrant: "Top-left" },
  { name: "Riverside",          state: "CA", demand: 62, trades: 28, rating: "Red",   note: "LA spillover demand, scarce labor",               quadrant: "Top-left" },
  { name: "Los Angeles",        state: "CA", demand: 60, trades: 18, rating: "Red",   note: "Extreme labor crunch + regulation",               quadrant: "Top-left" },
  { name: "San Diego",          state: "CA", demand: 55, trades: 22, rating: "Red",   note: "Tight labor, heavy regulatory burden",            quadrant: "Top-left" },
  { name: "Seattle",            state: "WA", demand: 58, trades: 30, rating: "Red",   note: "Strong demand, limited trade pipeline",           quadrant: "Top-left" },
  { name: "Denver",             state: "CO", demand: 55, trades: 32, rating: "Red",   note: "Cost pressure squeezing labor supply",            quadrant: "Top-left" },
  { name: "Sarasota",           state: "FL", demand: 60, trades: 35, rating: "Red",   note: "Retirement-driven growth straining trades",       quadrant: "Top-left" },
  { name: "Cape Coral",         state: "FL", demand: 58, trades: 36, rating: "Red",   note: "Recovery building, trades stretched",             quadrant: "Top-left" },
  { name: "Charleston",         state: "SC", demand: 55, trades: 42, rating: "Amber", note: "Coastal demand picking up, trades thin",          quadrant: "Top-left" },

  // Bottom-right — Untapped capacity (low demand, high trades)
  { name: "Indianapolis",       state: "IN", demand: 40, trades: 65, rating: "Green", note: "Available trades, demand hasn't caught up",       quadrant: "Bottom-right" },
  { name: "Columbus",           state: "OH", demand: 42, trades: 63, rating: "Green", note: "Stable labor, semiconductor growth coming",       quadrant: "Bottom-right" },
  { name: "Kansas City",        state: "MO", demand: 35, trades: 68, rating: "Green", note: "Ample trades waiting for more starts",            quadrant: "Bottom-right" },
  { name: "Oklahoma City",      state: "OK", demand: 38, trades: 70, rating: "Green", note: "Affordable labor, steady but modest starts",      quadrant: "Bottom-right" },
  { name: "Cincinnati",         state: "OH", demand: 35, trades: 62, rating: "Amber", note: "Trades available, market flat",                   quadrant: "Bottom-right" },
  { name: "Birmingham",         state: "AL", demand: 35, trades: 60, rating: "Amber", note: "Labor surplus, modest pipeline",                  quadrant: "Bottom-right" },
  { name: "Memphis",            state: "TN", demand: 32, trades: 58, rating: "Amber", note: "Low demand, available workforce",                 quadrant: "Bottom-right" },
  { name: "St. Louis",          state: "MO", demand: 30, trades: 65, rating: "Amber", note: "Surplus labor, weak housing starts",              quadrant: "Bottom-right" },
  { name: "Detroit",            state: "MI", demand: 28, trades: 60, rating: "Amber", note: "Recovery phase, trades available",                quadrant: "Bottom-right" },
  { name: "Milwaukee",          state: "WI", demand: 30, trades: 57, rating: "Amber", note: "Modest demand, adequate labor",                   quadrant: "Bottom-right" },
  { name: "Salt Lake City",     state: "UT", demand: 48, trades: 60, rating: "Green", note: "Good pipeline, demand cooling",                   quadrant: "Bottom-right" },
  { name: "Boise",              state: "ID", demand: 45, trades: 55, rating: "Amber", note: "Smaller market, balanced ratio",                  quadrant: "Bottom-right" },
  { name: "Greenville",         state: "SC", demand: 48, trades: 56, rating: "Amber", note: "Emerging growth, trades in place",                quadrant: "Bottom-right" },
  { name: "Richmond",           state: "VA", demand: 50, trades: 55, rating: "Amber", note: "Steady mid-Atlantic, balanced",                   quadrant: "Bottom-right" },

  // Bottom-left — Low opportunity (low demand, low trades)
  { name: "San Francisco",      state: "CA", demand: 40, trades: 15, rating: "Red",   note: "Permitting + labor bottleneck",                   quadrant: "Bottom-left" },
  { name: "New York",           state: "NY", demand: 45, trades: 18, rating: "Red",   note: "Union-heavy, extreme barriers to entry",          quadrant: "Bottom-left" },
  { name: "Boston",             state: "MA", demand: 38, trades: 22, rating: "Red",   note: "High cost, permitting constraints",               quadrant: "Bottom-left" },
  { name: "Sacramento",         state: "CA", demand: 45, trades: 28, rating: "Red",   note: "Growing but severely constrained",                quadrant: "Bottom-left" },
  { name: "Portland",           state: "OR", demand: 38, trades: 30, rating: "Amber", note: "Regulatory drag, moderate labor",                 quadrant: "Bottom-left" },
  { name: "Washington",         state: "DC", demand: 40, trades: 38, rating: "Amber", note: "Regulatory market, union labor",                  quadrant: "Bottom-left" },
  { name: "Baltimore",          state: "MD", demand: 32, trades: 42, rating: "Amber", note: "Slow growth, aging workforce",                    quadrant: "Bottom-left" },
  { name: "Philadelphia",       state: "PA", demand: 35, trades: 38, rating: "Amber", note: "Mature market, aging trades",                     quadrant: "Bottom-left" },
  { name: "Chicago",            state: "IL", demand: 38, trades: 35, rating: "Amber", note: "Large but flat, modest trades",                   quadrant: "Bottom-left" },
  { name: "Pittsburgh",         state: "PA", demand: 25, trades: 40, rating: "Amber", note: "Low starts, aging workforce",                     quadrant: "Bottom-left" },
  { name: "Cleveland",          state: "OH", demand: 22, trades: 38, rating: "Red",   note: "Minimal growth, shrinking trades",                quadrant: "Bottom-left" },
  { name: "Minneapolis",        state: "MN", demand: 38, trades: 45, rating: "Amber", note: "Seasonal constraints limit both",                 quadrant: "Bottom-left" },
  { name: "Tucson",             state: "AZ", demand: 48, trades: 42, rating: "Amber", note: "Moderate growth, tight labor",                    quadrant: "Bottom-left" },
];

/** Markets that get persistent text labels on the chart per spec section 5.4. */
export const LABELED_MARKETS = new Set<string>([
  "Houston", "Dallas-Fort Worth", "Phoenix", "Austin", "Nashville",
  "Miami", "Los Angeles", "San Francisco", "New York", "Atlanta",
  "Kansas City", "Indianapolis", "Seattle", "Denver", "Cleveland",
  "St. Louis", "San Antonio", "Charlotte", "Tampa", "Las Vegas",
  "Boston", "Oklahoma City",
]);

export const QUADRANT_COLORS = {
  Green: "#2d9d4f",
  Amber: "#d4920a",
  Red: "#c83a3a",
} as const;
