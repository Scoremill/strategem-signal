/**
 * Business Case page — per-market Phase 3 entry-strategy view.
 *
 * Server wrapper: auth, market lookup, raw-input fetch, and the
 * portfolio health snapshot + narrative for this market (so the PDF
 * export can embed the Financial/Demand/Operational scores and the
 * plain-English blurb alongside the business case). All the
 * interactive UI — sliders, re-running the pure scorers on every
 * change, rendering the result cards — lives in BusinessCaseClient.
 */
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  geographies,
  portfolioHealthSnapshots,
  marketNarratives,
  healthScoreWeights,
} from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { loadBusinessCaseInputs } from "@/lib/business-case/loader";
import BusinessCaseClient from "./BusinessCaseClient";
import { resolvePreset } from "@/lib/scoring/weight-presets";
import type { MarketHealthBundle } from "./BusinessCaseClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BusinessCasePage({ params }: PageProps) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const { id } = await params;

  const [market] = await db
    .select()
    .from(geographies)
    .where(eq(geographies.id, id))
    .limit(1);
  if (!market) notFound();

  // Run the three reads that don't depend on each other in parallel.
  const [raw, snapshot, narrative, weightRow] = await Promise.all([
    loadBusinessCaseInputs(market.id),
    db
      .select()
      .from(portfolioHealthSnapshots)
      .where(eq(portfolioHealthSnapshots.geographyId, market.id))
      .orderBy(desc(portfolioHealthSnapshots.snapshotDate))
      .limit(1),
    db
      .select()
      .from(marketNarratives)
      .where(eq(marketNarratives.geographyId, market.id))
      .orderBy(desc(marketNarratives.snapshotDate))
      .limit(1),
    db
      .select()
      .from(healthScoreWeights)
      .where(
        and(
          eq(healthScoreWeights.userId, session.userId),
          eq(healthScoreWeights.orgId, session.orgId)
        )
      )
      .limit(1),
  ]);

  const snap = snapshot[0] ?? null;
  const narr = narrative[0] ?? null;
  const preset = resolvePreset(weightRow[0]?.presetName);

  const toNum = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };

  const health: MarketHealthBundle | null = snap
    ? {
        financialScore: toNum(snap.financialScore),
        demandScore: toNum(snap.demandScore),
        operationalScore: toNum(snap.operationalScore),
        snapshotDate: String(snap.snapshotDate ?? "").slice(0, 10),
        presetName: preset.name,
        weights: preset.weights,
        inputsJson: snap.inputsJson as Record<string, unknown> | null,
        portfolioHealthBlurb: narr?.portfolioHealthBlurb ?? null,
      }
    : null;

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <div className="mb-4 flex items-center gap-2 text-xs text-[#6B7280]">
        <Link
          href={`/markets/${market.id}`}
          className="hover:text-[#1E293B] transition-colors"
        >
          ← {market.shortName}, {market.state}
        </Link>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E293B]">
          Business Case — {market.shortName}, {market.state}
        </h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Organic entry vs acquisition, with a portfolio-blend land
          position. Drag the sliders to stress-test — every number
          re-computes instantly. The final call is yours; the app
          narrates the data, it does not prescribe the decision.
        </p>
      </div>
      <BusinessCaseClient
        geographyId={market.id}
        marketLabel={`${market.shortName}, ${market.state}`}
        rawOrganic={raw.organic}
        acquisitionTargets={raw.acquisitionTargets}
        marketHealth={health}
      />
    </div>
  );
}
