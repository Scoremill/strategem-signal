/**
 * Business Case page — per-market Phase 3 entry-strategy view.
 *
 * Server wrapper: auth, market lookup, raw-input fetch. All the
 * interactive UI — sliders, re-running the pure scorers on every
 * change, rendering the result cards — lives in BusinessCaseClient.
 * The scorer modules are pure, so the client owns input state and
 * recomputes everything in-browser with zero network round trips.
 */
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { geographies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { loadBusinessCaseInputs } from "@/lib/business-case/loader";
import BusinessCaseClient from "./BusinessCaseClient";

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

  const raw = await loadBusinessCaseInputs(market.id);

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
      />
    </div>
  );
}
