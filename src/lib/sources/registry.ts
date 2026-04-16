/**
 * Source URL registry — one source of truth for the canonical upstream
 * URL and display label of every data feed we ingest.
 *
 * Keys are the `source` strings stored on every SourceTrace in the DB
 * (e.g. "census_permits", "bls_qcew", "zillow_zhvi_metro"). Values carry
 * the display label the UI should show, a short description, and the
 * URL the CEO can click to reach the authoritative upstream source.
 *
 * This is the companion to scripts/generate_data_sources_doc.py — the
 * Word doc explains what/when/where for engineers; this registry
 * powers the in-app "View Sources" modal for CEOs.
 */

export interface SourceDefinition {
  /** Human-readable label ("Census Building Permits Survey"). */
  label: string;
  /** Two-to-five word agency / provider ("U.S. Census Bureau"). */
  provider: string;
  /** Short description (<120 chars) of what this feed gives us. */
  description: string;
  /** Canonical upstream URL the CEO can click to verify. */
  url: string;
}

/**
 * Keys here match the `source` string stored on each SourceTrace in
 * the DB. If a pipeline writes a source string that's not in this
 * registry, the modal falls back to showing the raw string — not
 * ideal, but non-breaking.
 */
export const SOURCE_REGISTRY: Record<string, SourceDefinition> = {
  census_permits: {
    label: "Building Permits Survey (BPS)",
    provider: "U.S. Census Bureau",
    description:
      "Monthly single-family residential building permits by metro. Primary leading indicator of home-construction demand.",
    url: "https://www.census.gov/construction/bps/",
  },
  census_acs: {
    label: "American Community Survey · B19013",
    provider: "U.S. Census Bureau",
    description:
      "Annual median household income by metro. Drives affordability signals.",
    url: "https://www.census.gov/programs-surveys/acs/",
  },
  census_pep: {
    label: "Population Estimates Program (PEP)",
    provider: "U.S. Census Bureau",
    description:
      "Annual population change and net domestic migration by metro.",
    url: "https://www.census.gov/programs-surveys/popest.html",
  },
  bls_ces: {
    label: "Current Employment Statistics (CES)",
    provider: "U.S. Bureau of Labor Statistics",
    description:
      "Total nonfarm employment by metro, with YoY change.",
    url: "https://www.bls.gov/ces/",
  },
  bls_laus: {
    label: "Local Area Unemployment Statistics (LAUS)",
    provider: "U.S. Bureau of Labor Statistics",
    description: "Unemployment rate by metro.",
    url: "https://www.bls.gov/lau/",
  },
  bls_qcew: {
    label: "Quarterly Census of Employment & Wages (QCEW)",
    provider: "U.S. Bureau of Labor Statistics",
    description:
      "Quarterly construction-trade employment and wages (NAICS 2382/2383/2389).",
    url: "https://www.bls.gov/cew/",
  },
  bls_oes: {
    label: "Occupational Employment & Wage Statistics (OEWS)",
    provider: "U.S. Bureau of Labor Statistics",
    description:
      "Annual construction-occupation wages (SOC 47-xxxx). Metro coverage limited.",
    url: "https://www.bls.gov/oes/",
  },
  fhfa_metro: {
    label: "House Price Index (HPI) — Metro",
    provider: "Federal Housing Finance Agency",
    description:
      "Quarterly home-price index by metro. Trajectory signal for affordability runway.",
    url: "https://www.fhfa.gov/DataTools/Downloads",
  },
  zillow_zhvi_metro: {
    label: "Home Value Index (ZHVI) — Metro",
    provider: "Zillow Research",
    description:
      "Monthly median home value in dollars by metro.",
    url: "https://www.zillow.com/research/data/",
  },
  ops_builder_markets: {
    label: "Builder Market Presence (Filter 4)",
    provider: "StrategemOps · earnings-narrative extractor",
    description:
      "LLM-extracted map of which public builders cite which metros in their earnings calls. Covers ~18 public builders.",
    url: "",
  },
};

/**
 * Resolve a source string to its registry entry. Falls back to a
 * synthesized definition with the raw string as the label if there's
 * no match — preserves the modal's behavior for any future source
 * that hasn't been registered yet.
 */
export function resolveSource(sourceKey: string | null | undefined): SourceDefinition {
  if (!sourceKey) {
    return {
      label: "Unknown source",
      provider: "",
      description: "",
      url: "",
    };
  }
  const hit = SOURCE_REGISTRY[sourceKey];
  if (hit) return hit;
  return {
    label: sourceKey,
    provider: "",
    description: "",
    url: "",
  };
}
