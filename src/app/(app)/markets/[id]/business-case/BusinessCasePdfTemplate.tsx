/**
 * Hidden DOM template used as the source for the PDF rasterization.
 *
 * Everything here is inline hex — NO Tailwind classes. Tailwind v4
 * emits oklch() colors which html2canvas 1.x cannot parse; pure hex
 * avoids the problem entirely and keeps the PDF deterministic.
 *
 * Sized at 780px wide (fits 8.5" portrait at 0.5" margins, 2x scale).
 * Mounted by the client off-screen (left: -10000px) while the export
 * runs; the parent tears it down when done.
 */
import type {
  AcquisitionOutput,
  BusinessCaseInputs,
  OrganicBucketOutput,
  OrganicOutput,
  Recommendation,
} from "@/lib/business-case/types";
import type { MarketHealthBundle } from "./BusinessCaseClient";

interface Props {
  id: string;
  marketLabel: string;
  inputs: BusinessCaseInputs;
  organic: OrganicOutput;
  acquisition: AcquisitionOutput;
  recommendation: Recommendation;
  rationale: string;
  marketHealth: MarketHealthBundle | null;
  generatedAt: string;
  userName?: string | null;
}

// ── Colors (matches Strategem brand: orange accent, dark-blue body) ──
const C = {
  orange: "#F97316",
  orangeDark: "#EA580C",
  orangeTint: "#FFF7ED",
  orangeText: "#9A3412",
  blue: "#3B82F6",
  blueTint: "#EFF6FF",
  blueText: "#1E3A5F",
  red: "#EF4444",
  redTint: "#FEF2F2",
  redText: "#991B1B",
  body: "#1E293B",
  muted: "#6B7280",
  line: "#E5E7EB",
  white: "#FFFFFF",
};

// ── Formatters (duplicated from client but kept local for isolation) ──

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}
function fmtDollarsFull(n: number | null): string {
  if (n === null) return "—";
  return `$${n.toLocaleString()}`;
}
function fmtPct(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(1)}%`;
}
function fmtMonths(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(n >= 10 ? 0 : 1)} mo`;
}
function fmtTurns(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(n >= 10 ? 0 : 1)}×`;
}

export default function BusinessCasePdfTemplate({
  id,
  marketLabel,
  inputs,
  organic,
  acquisition,
  recommendation,
  rationale,
  marketHealth,
  generatedAt,
  userName,
}: Props) {
  const recLabel =
    recommendation === "organic"
      ? "Lean Organic"
      : recommendation === "acquisition"
      ? "Lean Acquisition"
      : "Pass";
  const recBg =
    recommendation === "organic"
      ? C.orangeTint
      : recommendation === "acquisition"
      ? C.blueTint
      : C.redTint;
  const recBorder =
    recommendation === "organic"
      ? C.orange
      : recommendation === "acquisition"
      ? C.blue
      : C.red;
  const recText =
    recommendation === "organic"
      ? C.orangeText
      : recommendation === "acquisition"
      ? C.blueText
      : C.redText;

  const buckets: Array<{ name: string; data: OrganicBucketOutput }> = [
    { name: "Finished lots", data: organic.finished },
    { name: "Raw land", data: organic.raw },
    { name: "Optioned", data: organic.optioned },
  ];

  return (
    <div
      id={id}
      style={{
        position: "fixed",
        top: 0,
        left: -10000,
        width: 780,
        padding: 36,
        background: C.white,
        color: C.body,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: 12,
        lineHeight: 1.4,
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div
        style={{
          borderBottom: `3px solid ${C.orange}`,
          paddingBottom: 12,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                color: C.orange,
                fontWeight: 700,
                marginBottom: 2,
              }}
            >
              StrategemSignal · Business Case
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: C.body,
              }}
            >
              {marketLabel}
            </div>
            <div
              style={{
                fontSize: 9,
                color: C.muted,
                marginTop: 2,
              }}
            >
              {organic.tierLabel} · Operational execution:{" "}
              <strong style={{ color: C.body }}>
                {organic.executionLabel}
              </strong>
              {" · "}
              {organic.assumptions.medianHomeSqft?.toLocaleString() ?? "—"} sqft
              · ${organic.assumptions.baseBuildCostPerSqft ?? "—"}/sqft base ·{" "}
              {organic.assumptions.newConstructionPremium != null
                ? `+${Math.round((organic.assumptions.newConstructionPremium - 1) * 100)}% new-construction premium`
                : ""}
            </div>
          </div>
          <div
            style={{
              fontSize: 10,
              color: C.muted,
              textAlign: "right",
            }}
          >
            <div>Generated {generatedAt}</div>
            {userName && <div>by {userName}</div>}
          </div>
        </div>
      </div>

      {/* Recommendation banner */}
      <div
        style={{
          borderLeft: `4px solid ${recBorder}`,
          background: recBg,
          color: recText,
          padding: "12px 14px",
          borderRadius: 6,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 1,
              background: C.white,
              padding: "3px 8px",
              borderRadius: 999,
              whiteSpace: "nowrap",
            }}
          >
            Advisory · {recLabel}
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.5 }}>{rationale}</div>
        </div>
      </div>

      {/* Market Health section — sub-scores + blurb + top raw inputs */}
      {marketHealth && (
        <MarketHealthSection health={marketHealth} />
      )}

      {/* Assumptions strip */}
      <SectionLabel>Market Assumptions</SectionLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <KpiTile
          label="Median home price"
          value={fmtDollarsFull(organic.assumptions.medianHomePrice)}
          sub={
            organic.assumptions.medianHomePriceAsOf
              ? `Zillow ZHVI · ${organic.assumptions.medianHomePriceAsOf}`
              : "Zillow ZHVI"
          }
        />
        <KpiTile
          label="Projected sale price"
          value={fmtDollarsFull(organic.assumptions.projectedSalePrice)}
          sub={
            organic.assumptions.newConstructionPremium != null
              ? `+${Math.round((organic.assumptions.newConstructionPremium - 1) * 100)}% new-construction premium`
              : "New-construction premium"
          }
        />
        <KpiTile
          label="Raw land per unit"
          value={fmtDollarsFull(organic.assumptions.landCostPerUnit)}
          sub={`${inputs.landCostSharePct}% land cost share`}
        />
        <KpiTile
          label="Base build cost"
          value={fmtDollarsFull(organic.assumptions.baseBuildCost)}
          sub={
            organic.assumptions.medianHomeSqft != null &&
            organic.assumptions.baseBuildCostPerSqft != null
              ? `$${organic.assumptions.baseBuildCostPerSqft}/sqft × ${organic.assumptions.medianHomeSqft.toLocaleString()} sqft (QCEW-adj)`
              : "QCEW-derived"
          }
        />
      </div>

      {/* Side-by-side models */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 16,
        }}
      >
        {/* Organic */}
        <div
          style={{
            border: `1px solid ${C.line}`,
            borderRadius: 8,
            padding: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 2,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 800, color: C.body }}>
              Organic Entry
            </div>
            <div
              style={{
                fontSize: 8,
                textTransform: "uppercase",
                letterSpacing: 0.8,
                color: C.orange,
                fontWeight: 700,
              }}
            >
              Blended portfolio
            </div>
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 10 }}>
            Build from scratch using a three-bucket land mix.
          </div>
          <StatLine
            label="Capital per unit"
            value={fmtDollarsFull(organic.blendedCapitalPerUnit)}
            emphasis
          />
          <StatLine
            label="Months to first closing"
            value={fmtMonths(organic.blendedMonthsToFirstClosing)}
          />
          <StatLine
            label="Gross margin (reported-equiv)"
            value={fmtPct(organic.blendedGrossMarginPct)}
          />
          <StatLine
            label="Capital turns / yr"
            value={fmtTurns(organic.blendedCapitalTurnsPerYear)}
          />
          <StatLine
            label="Cycle contribution (pre-SG&A)"
            value={fmtPct(organic.blendedCycleContributionPct)}
          />
          <StatLine
            label="Estimated ROIC (post-SG&A)"
            value={fmtPct(organic.blendedEstimatedRoicPct)}
            emphasis
          />
          <StatLine
            label="Year-one capital deployed"
            value={fmtMoney(organic.yearOneCapitalDeployed)}
            last
          />
        </div>

        {/* Acquisition */}
        <div
          style={{
            border: `1px solid ${C.line}`,
            borderRadius: 8,
            padding: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 2,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 800, color: C.body }}>
              Acquisition Entry
            </div>
            <div
              style={{
                fontSize: 8,
                textTransform: "uppercase",
                letterSpacing: 0.8,
                color: C.blue,
                fontWeight: 700,
              }}
            >
              Comparator
            </div>
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 10 }}>
            Buy a running start — directional, not a deal quote.
          </div>
          <StatLine
            label="Estimated cost per unit"
            value={fmtDollarsFull(acquisition.estimatedCostPerUnit)}
            emphasis
          />
          <StatLine
            label="Assumed multiple"
            value={`${acquisition.assumedMultiple.toFixed(1)}× organic`}
          />
          <StatLine
            label="Credible targets"
            value={`${acquisition.targets.length} public builder${
              acquisition.targets.length === 1 ? "" : "s"
            }`}
            last={acquisition.targets.length === 0}
          />
          {acquisition.targets.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  fontSize: 8,
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  color: C.muted,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                Who&apos;s here
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {acquisition.targets.slice(0, 5).map((t) => (
                  <div
                    key={t.ticker}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 9,
                    }}
                  >
                    <span>
                      <strong style={{ color: C.body }}>{t.ticker}</strong>
                      {t.companyName && (
                        <span style={{ color: C.muted }}> · {t.companyName}</span>
                      )}
                    </span>
                    <span style={{ color: C.muted }}>
                      {t.confidence} · {t.mentionCount}×
                    </span>
                  </div>
                ))}
                {acquisition.targets.length > 5 && (
                  <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>
                    +{acquisition.targets.length - 5} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Portfolio breakdown table */}
      <SectionLabel>Portfolio Breakdown</SectionLabel>
      <div
        style={{
          border: `1px solid ${C.line}`,
          borderRadius: 8,
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 10,
          }}
        >
          <thead>
            <tr style={{ background: C.orangeTint }}>
              <Th align="left">Bucket</Th>
              <Th>Mix</Th>
              <Th>Capital / unit</Th>
              <Th>Months</Th>
              <Th>Margin</Th>
              <Th>Turns</Th>
              <Th>Cycle</Th>
              <Th>Est. ROIC</Th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b, i) => (
              <tr
                key={b.name}
                style={{ background: i % 2 === 0 ? C.white : "#FFFBF5" }}
              >
                <Td align="left" bold>
                  {b.name}
                </Td>
                <Td>{b.data.mixPct}%</Td>
                <Td>{fmtDollarsFull(b.data.capitalPerUnit)}</Td>
                <Td>{fmtMonths(b.data.monthsToFirstClosing)}</Td>
                <Td>{fmtPct(b.data.grossMarginPct)}</Td>
                <Td>{fmtTurns(b.data.capitalTurnsPerYear)}</Td>
                <Td>{fmtPct(b.data.cycleContributionPct)}</Td>
                <Td>{fmtPct(b.data.estimatedRoicPct)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        <div
          style={{
            padding: "6px 12px 8px 12px",
            borderTop: `1px solid ${C.line}`,
            background: C.white,
            fontSize: 8,
            color: C.muted,
            lineHeight: 1.4,
          }}
        >
          <strong style={{ color: C.body }}>How to read this table:</strong>{" "}
          Margin is reported-equivalent gross margin (after a 5-point haircut
          for commissions, closing costs, and capitalized interest). Turns is
          capital turns per year for each bucket — finished ~3, raw ~1 because
          land carries the community, optioned ~4 (NVR-style). Cycle is margin ×
          turns, PRE-SG&A — the community-level capital efficiency number. Est.
          ROIC is cycle minus a per-bucket SG&A haircut (finished 8%, raw 10%,
          optioned 6% at defaults). Don&apos;t confuse Cycle with shareholder
          ROIC; expect the gap to be 15-30 points of SG&A drag depending on the
          land strategy.
        </div>
      </div>

      {/* Warnings */}
      {(organic.warnings.length > 0 || acquisition.warnings.length > 0) && (
        <div
          style={{
            borderLeft: `4px solid ${C.orange}`,
            background: C.orangeTint,
            padding: "10px 14px",
            borderRadius: 6,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: C.orangeText,
              fontWeight: 700,
              marginBottom: 6,
            }}
          >
            Flags for the board
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {organic.warnings.map((w, i) => (
              <div key={`o${i}`} style={{ fontSize: 10, color: C.orangeText }}>
                <strong>Organic:</strong> {w}
              </div>
            ))}
            {acquisition.warnings.map((w, i) => (
              <div key={`a${i}`} style={{ fontSize: 10, color: C.orangeText }}>
                <strong>Acquisition:</strong> {w}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer — footprint of the CEO inputs */}
      <div
        style={{
          borderTop: `1px solid ${C.line}`,
          paddingTop: 10,
          marginTop: 6,
          fontSize: 9,
          color: C.muted,
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: C.body }}>Inputs:</strong>{" "}
        {inputs.landCostSharePct}% land cost share · absorption{" "}
        {inputs.absorptionMultiplier}× · operational execution{" "}
        <strong style={{ color: C.body }}>{organic.executionLabel}</strong> ·{" "}
        {inputs.targetUnitsPerYear.toLocaleString()} units/yr · mix{" "}
        {inputs.landMix.pctFinished}/{inputs.landMix.pctRaw}/
        {inputs.landMix.pctOptioned} finished/raw/optioned · horizontal{" "}
        {inputs.horizontalPctOfRaw}% of raw · option fee {inputs.optionFeePct}%
        <br />
        <strong style={{ color: C.body }}>Sources:</strong> Zillow ZHVI (home
        prices) · BLS QCEW (construction wages) · StrategemOps earnings
        narratives (builder presence) · NAHB Cost of Constructing (build
        cost baseline). Numbers are directional and intended to support — not
        replace — board-level judgment.
      </div>
    </div>
  );
}

// ── Small inline components ──────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9,
        textTransform: "uppercase",
        letterSpacing: 1.2,
        color: C.muted,
        fontWeight: 700,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${C.line}`,
        borderRadius: 6,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: 8,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: C.muted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 800,
          color: C.body,
          marginTop: 2,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 8, color: C.muted, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function StatLine({
  label,
  value,
  emphasis,
  last,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "6px 0",
        borderBottom: last ? "none" : `1px solid ${C.line}`,
      }}
    >
      <span style={{ fontSize: 10, color: C.muted }}>{label}</span>
      <span
        style={{
          fontSize: emphasis ? 16 : 11,
          fontWeight: emphasis ? 800 : 600,
          color: emphasis ? C.orange : C.body,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Th({
  children,
  align = "right",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "8px 12px",
        fontSize: 8,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        color: C.orangeText,
        fontWeight: 700,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "right",
  bold,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  bold?: boolean;
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "8px 12px",
        fontSize: 10,
        color: C.body,
        fontWeight: bold ? 600 : 400,
      }}
    >
      {children}
    </td>
  );
}

// ── Market Health section ────────────────────────────────────────

/**
 * Color ramp that matches the heatmap and drilldown page. Lets the
 * score tiles read at a glance — red for distress, orange for
 * borderline, yellow for neutral, light green for good, dark green
 * for strong.
 */
function scoreColor(score: number | null): string {
  if (score == null) return "#9CA3AF";
  if (score >= 65) return "#16A34A";
  if (score >= 55) return "#22C55E";
  if (score >= 45) return "#EAB308";
  if (score >= 35) return "#F97316";
  return "#DC2626";
}

interface SourceTrace {
  value: number | null;
  source: string;
  asOf: string;
}

interface PortfolioHealthInputsJson {
  permitsYoyPct?: SourceTrace;
  employmentYoyPct?: SourceTrace;
  unemploymentRate?: SourceTrace;
  populationChangePct?: SourceTrace;
  netDomesticMigration?: SourceTrace;
  medianHouseholdIncome?: SourceTrace;
  incomeYoyPct?: SourceTrace;
  qcewWageYoyPct?: SourceTrace;
  qcewEmploymentYoyPct?: SourceTrace;
}

function fmtInput(
  value: number | null,
  unit: "pct" | "dollars" | "count" | "rate"
): string {
  if (value == null) return "—";
  if (unit === "pct") {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  }
  if (unit === "rate") return `${value.toFixed(1)}%`;
  if (unit === "dollars") return `$${Math.round(value).toLocaleString()}`;
  return Math.round(value).toLocaleString();
}

function MarketHealthSection({
  health,
}: {
  health: import("./BusinessCaseClient").MarketHealthBundle;
}) {
  const inputs = (health.inputsJson ?? {}) as PortfolioHealthInputsJson;

  // Group the raw inputs for the compact per-sub-score table
  const rows: Array<{
    group: "Financial" | "Demand" | "Operational";
    label: string;
    trace: SourceTrace | undefined;
    unit: "pct" | "dollars" | "count" | "rate";
    sourceLabel: string;
  }> = [
    {
      group: "Financial",
      label: "Median household income",
      trace: inputs.medianHouseholdIncome,
      unit: "dollars",
      sourceLabel: "Census ACS",
    },
    {
      group: "Financial",
      label: "Income YoY",
      trace: inputs.incomeYoyPct,
      unit: "pct",
      sourceLabel: "Census ACS",
    },
    {
      group: "Demand",
      label: "Single-family permits YoY",
      trace: inputs.permitsYoyPct,
      unit: "pct",
      sourceLabel: "Census BPS",
    },
    {
      group: "Demand",
      label: "Nonfarm employment YoY",
      trace: inputs.employmentYoyPct,
      unit: "pct",
      sourceLabel: "BLS CES",
    },
    {
      group: "Demand",
      label: "Unemployment rate",
      trace: inputs.unemploymentRate,
      unit: "rate",
      sourceLabel: "BLS LAUS",
    },
    {
      group: "Demand",
      label: "Population change YoY",
      trace: inputs.populationChangePct,
      unit: "pct",
      sourceLabel: "Census PEP",
    },
    {
      group: "Demand",
      label: "Net domestic migration",
      trace: inputs.netDomesticMigration,
      unit: "count",
      sourceLabel: "Census PEP",
    },
    {
      group: "Operational",
      label: "Construction wage YoY",
      trace: inputs.qcewWageYoyPct,
      unit: "pct",
      sourceLabel: "BLS QCEW",
    },
    {
      group: "Operational",
      label: "Construction employment YoY",
      trace: inputs.qcewEmploymentYoyPct,
      unit: "pct",
      sourceLabel: "BLS QCEW",
    },
  ];

  const financialRows = rows.filter((r) => r.group === "Financial");
  const demandRows = rows.filter((r) => r.group === "Demand");
  const operationalRows = rows.filter((r) => r.group === "Operational");

  return (
    <>
      <SectionLabel>
        Market Health · {health.presetName} preset · as of{" "}
        {health.snapshotDate}
      </SectionLabel>

      {/* Three sub-score tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <ScoreTile
          label="Financial"
          sublabel={`Weight ${Math.round(health.weights.financial * 100)}%`}
          score={health.financialScore}
        />
        <ScoreTile
          label="Demand"
          sublabel={`Weight ${Math.round(health.weights.demand * 100)}%`}
          score={health.demandScore}
        />
        <ScoreTile
          label="Operational"
          sublabel={`Weight ${Math.round(health.weights.operational * 100)}%`}
          score={health.operationalScore}
        />
      </div>

      {/* Plain-English blurb */}
      {health.portfolioHealthBlurb && (
        <div
          style={{
            border: `1px solid ${C.line}`,
            background: "#F8FAFC",
            padding: "10px 14px",
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 11,
            lineHeight: 1.5,
            color: C.body,
          }}
        >
          {health.portfolioHealthBlurb}
        </div>
      )}

      {/* Raw inputs grouped by sub-score */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <SubScoreInputs title="Financial" rows={financialRows} />
        <SubScoreInputs title="Demand" rows={demandRows} />
        <SubScoreInputs title="Operational" rows={operationalRows} />
      </div>
    </>
  );
}

function ScoreTile({
  label,
  sublabel,
  score,
}: {
  label: string;
  sublabel: string;
  score: number | null;
}) {
  const color = scoreColor(score);
  return (
    <div
      style={{
        border: `1px solid ${C.line}`,
        borderTop: `4px solid ${color}`,
        borderRadius: 6,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        minHeight: 72,
      }}
    >
      <div
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: C.muted,
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          color,
          lineHeight: 1,
          marginTop: 4,
        }}
      >
        {score == null ? "—" : score.toFixed(0)}
      </div>
      <div style={{ fontSize: 8, color: C.muted, marginTop: 4 }}>
        {sublabel}
      </div>
    </div>
  );
}

function SubScoreInputs({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    label: string;
    trace: SourceTrace | undefined;
    unit: "pct" | "dollars" | "count" | "rate";
    sourceLabel: string;
  }>;
}) {
  return (
    <div
      style={{
        border: `1px solid ${C.line}`,
        borderRadius: 6,
        padding: "8px 10px",
      }}
    >
      <div
        style={{
          fontSize: 8,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: C.muted,
          fontWeight: 700,
          marginBottom: 6,
          paddingBottom: 4,
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        {title} inputs
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {rows.map((r) => (
          <div
            key={r.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              fontSize: 9,
            }}
          >
            <div style={{ color: C.muted, paddingRight: 6 }}>
              <div style={{ color: C.body }}>{r.label}</div>
              <div style={{ fontSize: 7, color: C.muted }}>
                {r.sourceLabel}
                {r.trace?.asOf ? ` · ${r.trace.asOf}` : ""}
              </div>
            </div>
            <div
              style={{
                fontWeight: 700,
                color: C.body,
                whiteSpace: "nowrap",
              }}
            >
              {fmtInput(r.trace?.value ?? null, r.unit)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
