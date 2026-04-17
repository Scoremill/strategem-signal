import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { geographies } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import DataHealthClient, { type MarketCoverage } from "./DataHealthClient";

export const dynamic = "force-dynamic";

export default async function DataHealthPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!session.isSuperadmin && session.role !== "owner") {
    redirect("/heatmap");
  }

  const rows = await db.execute(sql`
    SELECT
      g.id,
      g.short_name,
      g.state,
      g.cbsa_fips,
      (SELECT COUNT(*) FROM permit_data pd WHERE pd.geography_id = g.id) AS permits,
      (SELECT COUNT(*) FROM employment_data ed WHERE ed.geography_id = g.id) AS employment,
      (SELECT COUNT(*) FROM employment_data ed WHERE ed.geography_id = g.id AND ed.unemployment_rate IS NOT NULL) AS unemployment,
      (SELECT COUNT(*) FROM migration_data md WHERE md.geography_id = g.id) AS migration,
      (SELECT COUNT(*) FROM income_data id WHERE id.geography_id = g.id) AS income,
      (SELECT COUNT(*) FROM trade_capacity_data td WHERE td.geography_id = g.id) AS qcew,
      (SELECT COUNT(*) FROM zillow_zhvi z WHERE z.geography_id = g.id) AS zhvi,
      (SELECT COUNT(*) FROM fhfa_hpi h WHERE h.geography_id = g.id) AS fhfa,
      (SELECT composite_score FROM portfolio_health_snapshots phs
        WHERE phs.geography_id = g.id
        ORDER BY phs.snapshot_date DESC LIMIT 1) AS latest_composite,
      (SELECT demand_score FROM portfolio_health_snapshots phs
        WHERE phs.geography_id = g.id
        ORDER BY phs.snapshot_date DESC LIMIT 1) AS latest_demand,
      (SELECT financial_score FROM portfolio_health_snapshots phs
        WHERE phs.geography_id = g.id
        ORDER BY phs.snapshot_date DESC LIMIT 1) AS latest_financial,
      (SELECT operational_score FROM portfolio_health_snapshots phs
        WHERE phs.geography_id = g.id
        ORDER BY phs.snapshot_date DESC LIMIT 1) AS latest_operational
    FROM geographies g
    WHERE g.is_active = true
    ORDER BY g.short_name
  `);

  const markets: MarketCoverage[] = (rows.rows as any[]).map((r) => ({
    id: r.id,
    shortName: r.short_name,
    state: r.state,
    cbsaFips: r.cbsa_fips,
    permits: Number(r.permits),
    employment: Number(r.employment),
    unemployment: Number(r.unemployment),
    migration: Number(r.migration),
    income: Number(r.income),
    qcew: Number(r.qcew),
    zhvi: Number(r.zhvi),
    fhfa: Number(r.fhfa),
    composite: r.latest_composite ? parseFloat(r.latest_composite) : null,
    demand: r.latest_demand ? parseFloat(r.latest_demand) : null,
    financial: r.latest_financial ? parseFloat(r.latest_financial) : null,
    operational: r.latest_operational ? parseFloat(r.latest_operational) : null,
  }));

  const summary = {
    total: markets.length,
    permits: markets.filter((m) => m.permits > 0).length,
    employment: markets.filter((m) => m.employment > 0).length,
    unemployment: markets.filter((m) => m.unemployment > 0).length,
    migration: markets.filter((m) => m.migration > 0).length,
    income: markets.filter((m) => m.income > 0).length,
    qcew: markets.filter((m) => m.qcew > 0).length,
    zhvi: markets.filter((m) => m.zhvi > 0).length,
    fhfa: markets.filter((m) => m.fhfa > 0).length,
    allThreeScores: markets.filter(
      (m) => m.demand != null && m.financial != null && m.operational != null
    ).length,
  };

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-[#1E293B]">
          Data Health Audit
        </h1>
        <p className="text-xs text-[#6B7280] mt-0.5">
          Coverage matrix for every active market — which data sources
          are populated and which have gaps
        </p>
      </header>
      <main className="flex-1 overflow-y-auto">
        <DataHealthClient markets={markets} summary={summary} />
      </main>
    </div>
  );
}
