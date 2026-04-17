import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
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

      -- Row counts (existence)
      (SELECT COUNT(*) FROM permit_data pd WHERE pd.geography_id = g.id) AS permits,
      (SELECT COUNT(*) FROM employment_data ed WHERE ed.geography_id = g.id) AS employment,
      (SELECT COUNT(*) FROM employment_data ed WHERE ed.geography_id = g.id AND ed.unemployment_rate IS NOT NULL) AS unemployment,
      (SELECT COUNT(*) FROM migration_data md WHERE md.geography_id = g.id) AS migration,
      (SELECT COUNT(*) FROM income_data id WHERE id.geography_id = g.id) AS income,
      (SELECT COUNT(*) FROM trade_capacity_data td WHERE td.geography_id = g.id) AS qcew,
      (SELECT COUNT(*) FROM zillow_zhvi z WHERE z.geography_id = g.id) AS zhvi,
      (SELECT COUNT(*) FROM fhfa_hpi h WHERE h.geography_id = g.id) AS fhfa,

      -- Latest scores
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
        ORDER BY phs.snapshot_date DESC LIMIT 1) AS latest_operational,

      -- Quality: opportunity filter scores (for anomaly detection)
      (SELECT filter_1_migration FROM market_opportunity_scores mos
        WHERE mos.geography_id = g.id
        ORDER BY mos.snapshot_date DESC LIMIT 1) AS opp_f1,
      (SELECT filter_2_diversity FROM market_opportunity_scores mos
        WHERE mos.geography_id = g.id
        ORDER BY mos.snapshot_date DESC LIMIT 1) AS opp_f2,
      (SELECT filter_3_imbalance FROM market_opportunity_scores mos
        WHERE mos.geography_id = g.id
        ORDER BY mos.snapshot_date DESC LIMIT 1) AS opp_f3,
      (SELECT filter_4_competitive FROM market_opportunity_scores mos
        WHERE mos.geography_id = g.id
        ORDER BY mos.snapshot_date DESC LIMIT 1) AS opp_f4,
      (SELECT filter_5_affordability FROM market_opportunity_scores mos
        WHERE mos.geography_id = g.id
        ORDER BY mos.snapshot_date DESC LIMIT 1) AS opp_f5,
      (SELECT filter_6_operational FROM market_opportunity_scores mos
        WHERE mos.geography_id = g.id
        ORDER BY mos.snapshot_date DESC LIMIT 1) AS opp_f6,

      -- Quality: sector breakdown depth (how many NAICS codes in diversity input)
      (SELECT COALESCE(
        (SELECT COUNT(*) FROM jsonb_object_keys(mos.inputs_json->'sectorEmployment'->'breakdown')),
        0
      ) FROM market_opportunity_scores mos
        WHERE mos.geography_id = g.id
        ORDER BY mos.snapshot_date DESC LIMIT 1) AS sector_count,

      -- Quality: permit history depth (need 12+ for YoY)
      (SELECT COUNT(DISTINCT pd.period_date) FROM permit_data pd WHERE pd.geography_id = g.id) AS permit_months,

      -- Quality: employment history depth
      (SELECT COUNT(DISTINCT ed.period_date) FROM employment_data ed WHERE ed.geography_id = g.id) AS employment_months

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
    oppF1: r.opp_f1 ? parseFloat(r.opp_f1) : null,
    oppF2: r.opp_f2 ? parseFloat(r.opp_f2) : null,
    oppF3: r.opp_f3 ? parseFloat(r.opp_f3) : null,
    oppF4: r.opp_f4 ? parseFloat(r.opp_f4) : null,
    oppF5: r.opp_f5 ? parseFloat(r.opp_f5) : null,
    oppF6: r.opp_f6 ? parseFloat(r.opp_f6) : null,
    sectorCount: Number(r.sector_count ?? 0),
    permitMonths: Number(r.permit_months ?? 0),
    employmentMonths: Number(r.employment_months ?? 0),
  }));

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-[#1E293B]">
          Data Health Audit
        </h1>
        <p className="text-xs text-[#6B7280] mt-0.5">
          Data coverage AND quality for every market — flags gaps,
          anomalous scores, and thin data behind computed numbers
        </p>
      </header>
      <main className="flex-1 overflow-y-auto">
        <DataHealthClient markets={markets} />
      </main>
    </div>
  );
}
