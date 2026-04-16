/**
 * Normalized data shapes the View Sources modal consumes.
 *
 * Every surface in the app (heatmap, drilldown, business case, etc.)
 * already carries its data-provenance tuples in slightly different
 * shapes. This module defines the single `DisplaySourceTrace` shape
 * the modal reads, plus small transformers for each upstream shape
 * that normalize to it.
 *
 * Why not unify the upstream shapes? Because they live in
 * database-serialized JSON and changing them would require a
 * migration of every saved business case and every scored snapshot.
 * The transformer layer is the pragmatic decoupling.
 */
import { resolveSource, type SourceDefinition } from "./registry";

export type TraceUnit = "pct" | "dollars" | "count" | "rate" | "index" | "none";

/** Canonical shape the modal renders. */
export interface DisplaySourceTrace {
  /** CEO-facing label for the metric ("Single-family permits YoY"). */
  label: string;
  /** The raw numeric value the UI showed. */
  value: number | null;
  /** Unit for formatting the value. */
  unit: TraceUnit;
  /** Publication date / snapshot date from the upstream provider. */
  asOf: string | null;
  /** Resolved source definition (provider, description, URL). */
  source: SourceDefinition;
  /**
   * Optional — when the displayed number is a derivation rather than
   * a direct reading, this sentence explains the formula in plain
   * English ("Blended margin × blended turns, minus weighted SG&A").
   */
  derivation?: string;
}

/** Format a value for display inside the modal. */
export function formatTraceValue(value: number | null, unit: TraceUnit): string {
  if (value == null) return "—";
  switch (unit) {
    case "pct": {
      const sign = value > 0 ? "+" : "";
      return `${sign}${value.toFixed(1)}%`;
    }
    case "rate":
      return `${value.toFixed(1)}%`;
    case "dollars":
      return `$${Math.round(value).toLocaleString()}`;
    case "count":
      return Math.round(value).toLocaleString();
    case "index":
      return value.toFixed(1);
    case "none":
    default:
      return String(value);
  }
}

// ─── Upstream shape: Portfolio Health InputsJson ────────────────────
// (matches src/app/(app)/markets/[id]/page.tsx InputsJson)
interface PortfolioHealthTrace {
  value: number | null;
  source: string;
  asOf: string;
}

interface PortfolioHealthInputsShape {
  permitsYoyPct: PortfolioHealthTrace;
  employmentYoyPct: PortfolioHealthTrace;
  unemploymentRate: PortfolioHealthTrace;
  populationChangePct: PortfolioHealthTrace;
  netDomesticMigration: PortfolioHealthTrace;
  medianHouseholdIncome: PortfolioHealthTrace;
  incomeYoyPct: PortfolioHealthTrace;
  qcewWageYoyPct: PortfolioHealthTrace;
  qcewEmploymentYoyPct: PortfolioHealthTrace;
}

const PH_FIELD_META: Array<{
  key: keyof PortfolioHealthInputsShape;
  label: string;
  unit: TraceUnit;
}> = [
  { key: "medianHouseholdIncome", label: "Median household income", unit: "dollars" },
  { key: "incomeYoyPct", label: "Income YoY", unit: "pct" },
  { key: "permitsYoyPct", label: "Single-family permits YoY", unit: "pct" },
  { key: "employmentYoyPct", label: "Total nonfarm employment YoY", unit: "pct" },
  { key: "populationChangePct", label: "Population change YoY", unit: "pct" },
  { key: "netDomesticMigration", label: "Net domestic migration", unit: "count" },
  { key: "unemploymentRate", label: "Unemployment rate", unit: "rate" },
  { key: "qcewWageYoyPct", label: "Construction wage YoY (weighted)", unit: "pct" },
  { key: "qcewEmploymentYoyPct", label: "Construction employment YoY (weighted)", unit: "pct" },
];

/**
 * Transformer: Portfolio Health snapshot inputsJson → DisplaySourceTrace[].
 */
export function tracesFromPortfolioHealth(
  inputs: PortfolioHealthInputsShape | null | undefined
): DisplaySourceTrace[] {
  if (!inputs) return [];
  return PH_FIELD_META.map((meta) => {
    const raw = inputs[meta.key];
    return {
      label: meta.label,
      value: raw?.value ?? null,
      unit: meta.unit,
      asOf: raw?.asOf ?? null,
      source: resolveSource(raw?.source),
    };
  });
}

// ─── Upstream shape: Business Case OrganicOutput.assumptions ────────
interface BusinessCaseAssumptions {
  medianHomePrice: number | null;
  medianHomePriceAsOf: string | null;
  landCostPerUnit: number | null;
  baseBuildCost: number | null;
  projectedSalePrice: number | null;
  medianHomeSqft: number | null;
  baseBuildCostPerSqft: number | null;
  newConstructionPremium: number | null;
}

/**
 * Transformer: Business Case assumptions → DisplaySourceTrace[].
 * The CEO-facing numbers on the assumptions strip each get their
 * own trace row, with the derivation note explaining how the
 * assumption was computed from the underlying feeds.
 */
export function tracesFromBusinessCaseAssumptions(
  assumptions: BusinessCaseAssumptions | null | undefined,
  landCostSharePct: number,
  tierLabel: string
): DisplaySourceTrace[] {
  if (!assumptions) return [];
  const premiumPct =
    assumptions.newConstructionPremium != null
      ? Math.round((assumptions.newConstructionPremium - 1) * 100)
      : null;

  return [
    {
      label: "Median home price",
      value: assumptions.medianHomePrice,
      unit: "dollars",
      asOf: assumptions.medianHomePriceAsOf,
      source: resolveSource("zillow_zhvi_metro"),
    },
    {
      label: "Projected sale price (new construction)",
      value: assumptions.projectedSalePrice,
      unit: "dollars",
      asOf: assumptions.medianHomePriceAsOf,
      source: resolveSource("zillow_zhvi_metro"),
      derivation:
        premiumPct != null
          ? `Median home price × ${(1 + premiumPct / 100).toFixed(2)} (+${premiumPct}% new-construction premium for ${tierLabel})`
          : undefined,
    },
    {
      label: "Raw land per unit",
      value: assumptions.landCostPerUnit,
      unit: "dollars",
      asOf: assumptions.medianHomePriceAsOf,
      source: resolveSource("zillow_zhvi_metro"),
      derivation: `Median home price × ${landCostSharePct}% land cost share`,
    },
    {
      label: "Base build cost",
      value: assumptions.baseBuildCost,
      unit: "dollars",
      asOf: null,
      source: resolveSource("bls_qcew"),
      derivation:
        assumptions.medianHomeSqft != null &&
        assumptions.baseBuildCostPerSqft != null
          ? `$${assumptions.baseBuildCostPerSqft}/sqft × ${assumptions.medianHomeSqft.toLocaleString()} sqft (${tierLabel} baseline), adjusted by QCEW regional wage index`
          : undefined,
    },
  ];
}
