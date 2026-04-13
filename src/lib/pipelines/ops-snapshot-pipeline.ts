/**
 * StrategemOps monthly snapshot pipeline.
 *
 * Reads the 14 whitelisted tables from the StrategemOps Neon DB via the
 * read-only strategem_signal_reader role and upserts them into the local
 * ops_* mirror tables in StrategemSignal's Neon DB. After this runs, all
 * user-facing app code can query the local mirror and never touch
 * StrategemOps directly.
 *
 * Design notes:
 *  - Per-table error isolation. If `ops_management_narratives` fails, the
 *    other 13 still complete and we write a `partial` status row to
 *    ops_snapshot_log with the failed table named.
 *  - Idempotent upserts by primary key. Re-running the pipeline immediately
 *    is safe; the daily self-heal cron relies on this.
 *  - Incremental pull: tables with a usable timestamp pull only rows
 *    changed since the last successful snapshot. Tables without one
 *    (benchmark_ranges, source_documents, filings) full-replace because
 *    they're small.
 *  - Heavy text fields (filings.filing_text, source_documents.text_content,
 *    filings.exhibits_index_json) are intentionally NOT mirrored. They stay
 *    in StrategemOps; we only mirror metadata + MD&A + risk factors.
 */
import { db } from "@/lib/db";
import { getOpsClient } from "@/lib/db/strategem-ops";
import { opsSnapshotLog } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface TableSnapshotResult {
  table: string;
  rowsFetched: number;
  rowsUpserted: number;
  durationMs: number;
  error: string | null;
}

export interface SnapshotPipelineResult {
  status: "success" | "partial" | "failed";
  totalRowsUpserted: number;
  durationMs: number;
  tables: TableSnapshotResult[];
  errors: string[];
}

/**
 * Find the most recent successful or partial snapshot timestamp so we can
 * pull only rows that changed since then. Returns null on first ever run.
 */
async function getLastSnapshotDate(): Promise<Date | null> {
  const rows = await db.execute(sql`
    SELECT MAX(run_started_at) AS last
    FROM ops_snapshot_log
    WHERE status IN ('success', 'partial')
  `);
  // drizzle-orm/neon-http returns a result object with `rows` array
  const row = (rows as unknown as { rows?: Array<{ last: string | null }> }).rows?.[0]
    ?? (Array.isArray(rows) ? (rows as Array<{ last: string | null }>)[0] : undefined);
  if (!row?.last) return null;
  return new Date(row.last);
}

/**
 * Snapshot a single source table.
 * `selectSql` is the raw SELECT against StrategemOps. `upsertOne` knows how to
 * write a single row to the local mirror via parameterized SQL.
 */
async function snapshotTable(
  tableName: string,
  selectSql: string,
  upsertOne: (row: Record<string, unknown>) => Promise<void>
): Promise<TableSnapshotResult> {
  const startTime = Date.now();
  const result: TableSnapshotResult = {
    table: tableName,
    rowsFetched: 0,
    rowsUpserted: 0,
    durationMs: 0,
    error: null,
  };

  try {
    const ops = getOpsClient();
    // .query() takes a raw SQL string; the tag-template form (ops`...`) only
    // works for inlined parameterized queries, which doesn't fit our dynamic
    // table-driven SELECT pattern.
    const rows = (await ops.query(selectSql)) as unknown as Record<string, unknown>[];
    result.rowsFetched = rows.length;

    for (const row of rows) {
      try {
        await upsertOne(row);
        result.rowsUpserted++;
      } catch (rowErr) {
        // Don't let a single bad row kill the whole table. Log and continue.
        console.warn(`[ops-snapshot] ${tableName} upsert failed for id=${row.id}:`, rowErr);
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

/**
 * Build an incremental WHERE clause if the source table has a usable
 * timestamp column. Returns empty string for tables we full-replace.
 */
function incrementalWhere(timestampCol: string | null, since: Date | null): string {
  if (!timestampCol || !since) return "";
  return ` WHERE ${timestampCol} >= '${since.toISOString()}'`;
}

/**
 * Run the full snapshot. Per-table error isolation: any individual failure
 * is captured in the result; the pipeline finishes and writes a partial-
 * status row to ops_snapshot_log.
 */
export async function runOpsSnapshotPipeline(): Promise<SnapshotPipelineResult> {
  const startTime = Date.now();
  const since = await getLastSnapshotDate();
  console.log(
    `[ops-snapshot] Starting. Last successful snapshot: ${since?.toISOString() ?? "(first run)"}`
  );

  const tables: TableSnapshotResult[] = [];
  const errors: string[] = [];

  // ─── companies ─────────────────────────────────────────────
  tables.push(
    await snapshotTable(
      "ops_companies",
      `SELECT id, ticker, company_name, cik, exchange, builder_category::text AS builder_category,
              fiscal_year_end, headquarters, ir_url, active_status, updated_at
       FROM companies${incrementalWhere("updated_at", since)}`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_companies (id, ticker, company_name, cik, exchange, builder_category,
            fiscal_year_end, headquarters, ir_url, active_status, snapshot_date)
          VALUES (${row.id}, ${row.ticker}, ${row.company_name}, ${row.cik}, ${row.exchange},
            ${row.builder_category}, ${row.fiscal_year_end}, ${row.headquarters}, ${row.ir_url},
            ${row.active_status}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            ticker = EXCLUDED.ticker,
            company_name = EXCLUDED.company_name,
            cik = EXCLUDED.cik,
            exchange = EXCLUDED.exchange,
            builder_category = EXCLUDED.builder_category,
            fiscal_year_end = EXCLUDED.fiscal_year_end,
            headquarters = EXCLUDED.headquarters,
            ir_url = EXCLUDED.ir_url,
            active_status = EXCLUDED.active_status,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── company_universe_registry ─────────────────────────────
  tables.push(
    await snapshotTable(
      "ops_company_universe_registry",
      `SELECT id, company_id, builder_100_year, builder_100_rank, public_status,
              inclusion_status::text AS inclusion_status, included_from_date, archived_date,
              notes, created_at
       FROM company_universe_registry${incrementalWhere("created_at", since)}`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_company_universe_registry (id, company_id, builder_100_year,
            builder_100_rank, public_status, inclusion_status, included_from_date,
            archived_date, notes, snapshot_date)
          VALUES (${row.id}, ${row.company_id}, ${row.builder_100_year},
            ${row.builder_100_rank}, ${row.public_status}, ${row.inclusion_status},
            ${row.included_from_date}, ${row.archived_date}, ${row.notes}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            company_id = EXCLUDED.company_id,
            builder_100_year = EXCLUDED.builder_100_year,
            builder_100_rank = EXCLUDED.builder_100_rank,
            public_status = EXCLUDED.public_status,
            inclusion_status = EXCLUDED.inclusion_status,
            included_from_date = EXCLUDED.included_from_date,
            archived_date = EXCLUDED.archived_date,
            notes = EXCLUDED.notes,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── financial_periods ─────────────────────────────────────
  tables.push(
    await snapshotTable(
      "ops_financial_periods",
      `SELECT id, company_id, period_type::text AS period_type, fiscal_year, fiscal_quarter,
              period_start, period_end, filing_date, accession_number, source_priority, updated_at
       FROM financial_periods${incrementalWhere("updated_at", since)}`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_financial_periods (id, company_id, period_type, fiscal_year,
            fiscal_quarter, period_start, period_end, filing_date, accession_number,
            source_priority, snapshot_date)
          VALUES (${row.id}, ${row.company_id}, ${row.period_type}, ${row.fiscal_year},
            ${row.fiscal_quarter}, ${row.period_start}, ${row.period_end}, ${row.filing_date},
            ${row.accession_number}, ${row.source_priority}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            company_id = EXCLUDED.company_id,
            period_type = EXCLUDED.period_type,
            fiscal_year = EXCLUDED.fiscal_year,
            fiscal_quarter = EXCLUDED.fiscal_quarter,
            period_start = EXCLUDED.period_start,
            period_end = EXCLUDED.period_end,
            filing_date = EXCLUDED.filing_date,
            accession_number = EXCLUDED.accession_number,
            source_priority = EXCLUDED.source_priority,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── financial_facts ───────────────────────────────────────
  tables.push(
    await snapshotTable(
      "ops_financial_facts",
      `SELECT id, financial_period_id, revenue, gross_profit, gross_margin, operating_income,
              operating_margin, net_income, eps_basic, eps_diluted, total_assets, total_debt,
              total_equity, cash_and_equivalents, operating_cash_flow, capex, free_cash_flow,
              homebuilding_revenue, financial_services_income, stock_price_at_report, updated_at
       FROM financial_facts${incrementalWhere("updated_at", since)}`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_financial_facts (id, financial_period_id, revenue, gross_profit,
            gross_margin, operating_income, operating_margin, net_income, eps_basic, eps_diluted,
            total_assets, total_debt, total_equity, cash_and_equivalents, operating_cash_flow,
            capex, free_cash_flow, homebuilding_revenue, financial_services_income,
            stock_price_at_report, snapshot_date)
          VALUES (${row.id}, ${row.financial_period_id}, ${row.revenue}, ${row.gross_profit},
            ${row.gross_margin}, ${row.operating_income}, ${row.operating_margin}, ${row.net_income},
            ${row.eps_basic}, ${row.eps_diluted}, ${row.total_assets}, ${row.total_debt},
            ${row.total_equity}, ${row.cash_and_equivalents}, ${row.operating_cash_flow},
            ${row.capex}, ${row.free_cash_flow}, ${row.homebuilding_revenue},
            ${row.financial_services_income}, ${row.stock_price_at_report}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            financial_period_id = EXCLUDED.financial_period_id,
            revenue = EXCLUDED.revenue,
            gross_profit = EXCLUDED.gross_profit,
            gross_margin = EXCLUDED.gross_margin,
            operating_income = EXCLUDED.operating_income,
            operating_margin = EXCLUDED.operating_margin,
            net_income = EXCLUDED.net_income,
            eps_basic = EXCLUDED.eps_basic,
            eps_diluted = EXCLUDED.eps_diluted,
            total_assets = EXCLUDED.total_assets,
            total_debt = EXCLUDED.total_debt,
            total_equity = EXCLUDED.total_equity,
            cash_and_equivalents = EXCLUDED.cash_and_equivalents,
            operating_cash_flow = EXCLUDED.operating_cash_flow,
            capex = EXCLUDED.capex,
            free_cash_flow = EXCLUDED.free_cash_flow,
            homebuilding_revenue = EXCLUDED.homebuilding_revenue,
            financial_services_income = EXCLUDED.financial_services_income,
            stock_price_at_report = EXCLUDED.stock_price_at_report,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── builder_operating_kpis ────────────────────────────────
  tables.push(
    await snapshotTable(
      "ops_builder_operating_kpis",
      `SELECT id, financial_period_id, homes_ordered, gross_orders, homes_closed,
              cancellation_rate, backlog_units, backlog_value, active_communities,
              average_active_communities, average_selling_price, backlog_asp, delivered_asp,
              lots_owned, lots_controlled, lots_under_contract, mortgage_capture_rate,
              completed_specs, specs_under_construction, orders_per_community,
              closings_per_community, backlog_turn_ratio, owned_to_controlled_ratio,
              completed_spec_risk_ratio, homes_in_inventory, source_doc_id, extraction_method,
              confidence_score, updated_at
       FROM builder_operating_kpis${incrementalWhere("updated_at", since)}`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_builder_operating_kpis (id, financial_period_id, homes_ordered,
            gross_orders, homes_closed, cancellation_rate, backlog_units, backlog_value,
            active_communities, average_active_communities, average_selling_price, backlog_asp,
            delivered_asp, lots_owned, lots_controlled, lots_under_contract, mortgage_capture_rate,
            completed_specs, specs_under_construction, orders_per_community, closings_per_community,
            backlog_turn_ratio, owned_to_controlled_ratio, completed_spec_risk_ratio,
            homes_in_inventory, source_doc_id, extraction_method, confidence_score, snapshot_date)
          VALUES (${row.id}, ${row.financial_period_id}, ${row.homes_ordered}, ${row.gross_orders},
            ${row.homes_closed}, ${row.cancellation_rate}, ${row.backlog_units}, ${row.backlog_value},
            ${row.active_communities}, ${row.average_active_communities}, ${row.average_selling_price},
            ${row.backlog_asp}, ${row.delivered_asp}, ${row.lots_owned}, ${row.lots_controlled},
            ${row.lots_under_contract}, ${row.mortgage_capture_rate}, ${row.completed_specs},
            ${row.specs_under_construction}, ${row.orders_per_community}, ${row.closings_per_community},
            ${row.backlog_turn_ratio}, ${row.owned_to_controlled_ratio}, ${row.completed_spec_risk_ratio},
            ${row.homes_in_inventory}, ${row.source_doc_id}, ${row.extraction_method},
            ${row.confidence_score}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            financial_period_id = EXCLUDED.financial_period_id,
            homes_ordered = EXCLUDED.homes_ordered,
            gross_orders = EXCLUDED.gross_orders,
            homes_closed = EXCLUDED.homes_closed,
            cancellation_rate = EXCLUDED.cancellation_rate,
            backlog_units = EXCLUDED.backlog_units,
            backlog_value = EXCLUDED.backlog_value,
            active_communities = EXCLUDED.active_communities,
            average_active_communities = EXCLUDED.average_active_communities,
            average_selling_price = EXCLUDED.average_selling_price,
            backlog_asp = EXCLUDED.backlog_asp,
            delivered_asp = EXCLUDED.delivered_asp,
            lots_owned = EXCLUDED.lots_owned,
            lots_controlled = EXCLUDED.lots_controlled,
            lots_under_contract = EXCLUDED.lots_under_contract,
            mortgage_capture_rate = EXCLUDED.mortgage_capture_rate,
            completed_specs = EXCLUDED.completed_specs,
            specs_under_construction = EXCLUDED.specs_under_construction,
            orders_per_community = EXCLUDED.orders_per_community,
            closings_per_community = EXCLUDED.closings_per_community,
            backlog_turn_ratio = EXCLUDED.backlog_turn_ratio,
            owned_to_controlled_ratio = EXCLUDED.owned_to_controlled_ratio,
            completed_spec_risk_ratio = EXCLUDED.completed_spec_risk_ratio,
            homes_in_inventory = EXCLUDED.homes_in_inventory,
            source_doc_id = EXCLUDED.source_doc_id,
            extraction_method = EXCLUDED.extraction_method,
            confidence_score = EXCLUDED.confidence_score,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── incentive_tracking ────────────────────────────────────
  tables.push(
    await snapshotTable(
      "ops_incentive_tracking",
      `SELECT id, company_id, financial_period_id, incentives_pct_revenue, buydown_offered,
              buydown_rate, source, notes, created_at
       FROM incentive_tracking${incrementalWhere("created_at", since)}`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_incentive_tracking (id, company_id, financial_period_id,
            incentives_pct_revenue, buydown_offered, buydown_rate, source, notes, snapshot_date)
          VALUES (${row.id}, ${row.company_id}, ${row.financial_period_id},
            ${row.incentives_pct_revenue}, ${row.buydown_offered}, ${row.buydown_rate},
            ${row.source}, ${row.notes}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            company_id = EXCLUDED.company_id,
            financial_period_id = EXCLUDED.financial_period_id,
            incentives_pct_revenue = EXCLUDED.incentives_pct_revenue,
            buydown_offered = EXCLUDED.buydown_offered,
            buydown_rate = EXCLUDED.buydown_rate,
            source = EXCLUDED.source,
            notes = EXCLUDED.notes,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── management_narratives ─────────────────────────────────
  tables.push(
    await snapshotTable(
      "ops_management_narratives",
      `SELECT id, company_id, fiscal_year, fiscal_quarter, source_document_id,
              narrative_type::text AS narrative_type, prepared_remarks_text, qa_text, full_text,
              source_method, confidence_score, created_at
       FROM management_narratives${incrementalWhere("created_at", since)}`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_management_narratives (id, company_id, fiscal_year, fiscal_quarter,
            source_document_id, narrative_type, prepared_remarks_text, qa_text, full_text,
            source_method, confidence_score, snapshot_date)
          VALUES (${row.id}, ${row.company_id}, ${row.fiscal_year}, ${row.fiscal_quarter},
            ${row.source_document_id}, ${row.narrative_type}, ${row.prepared_remarks_text},
            ${row.qa_text}, ${row.full_text}, ${row.source_method}, ${row.confidence_score}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            company_id = EXCLUDED.company_id,
            fiscal_year = EXCLUDED.fiscal_year,
            fiscal_quarter = EXCLUDED.fiscal_quarter,
            source_document_id = EXCLUDED.source_document_id,
            narrative_type = EXCLUDED.narrative_type,
            prepared_remarks_text = EXCLUDED.prepared_remarks_text,
            qa_text = EXCLUDED.qa_text,
            full_text = EXCLUDED.full_text,
            source_method = EXCLUDED.source_method,
            confidence_score = EXCLUDED.confidence_score,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── innovation_theme_mentions ─────────────────────────────
  tables.push(
    await snapshotTable(
      "ops_innovation_theme_mentions",
      `SELECT id, company_id, fiscal_year, fiscal_quarter, theme_name, mention_count,
              weighted_score, example_snippets_json, source_document_id, created_at
       FROM innovation_theme_mentions${incrementalWhere("created_at", since)}`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_innovation_theme_mentions (id, company_id, fiscal_year, fiscal_quarter,
            theme_name, mention_count, weighted_score, example_snippets_json, source_document_id,
            snapshot_date)
          VALUES (${row.id}, ${row.company_id}, ${row.fiscal_year}, ${row.fiscal_quarter},
            ${row.theme_name}, ${row.mention_count}, ${row.weighted_score},
            ${JSON.stringify(row.example_snippets_json)}::json, ${row.source_document_id}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            company_id = EXCLUDED.company_id,
            fiscal_year = EXCLUDED.fiscal_year,
            fiscal_quarter = EXCLUDED.fiscal_quarter,
            theme_name = EXCLUDED.theme_name,
            mention_count = EXCLUDED.mention_count,
            weighted_score = EXCLUDED.weighted_score,
            example_snippets_json = EXCLUDED.example_snippets_json,
            source_document_id = EXCLUDED.source_document_id,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── sentiment_scores ──────────────────────────────────────
  tables.push(
    await snapshotTable(
      "ops_sentiment_scores",
      `SELECT id, company_id, fiscal_year, fiscal_quarter, source_document_id, overall_sentiment,
              confidence_sentiment, risk_tone_score, demand_tone_score, margin_tone_score,
              land_tone_score, labor_tone_score, ai_overall_score, ai_overall_label,
              ai_demand_score, ai_demand_summary, ai_margin_score, ai_margin_summary,
              ai_labor_score, ai_labor_summary, ai_land_score, ai_land_summary,
              ai_confidence_score, ai_confidence_summary, ai_risk_score, ai_risk_summary,
              ai_trend_narrative, ai_scored_at, ai_model_version, created_at
       FROM sentiment_scores${incrementalWhere("created_at", since)}`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_sentiment_scores (id, company_id, fiscal_year, fiscal_quarter,
            source_document_id, overall_sentiment, confidence_sentiment, risk_tone_score,
            demand_tone_score, margin_tone_score, land_tone_score, labor_tone_score,
            ai_overall_score, ai_overall_label, ai_demand_score, ai_demand_summary,
            ai_margin_score, ai_margin_summary, ai_labor_score, ai_labor_summary,
            ai_land_score, ai_land_summary, ai_confidence_score, ai_confidence_summary,
            ai_risk_score, ai_risk_summary, ai_trend_narrative, ai_scored_at, ai_model_version,
            snapshot_date)
          VALUES (${row.id}, ${row.company_id}, ${row.fiscal_year}, ${row.fiscal_quarter},
            ${row.source_document_id}, ${row.overall_sentiment}, ${row.confidence_sentiment},
            ${row.risk_tone_score}, ${row.demand_tone_score}, ${row.margin_tone_score},
            ${row.land_tone_score}, ${row.labor_tone_score}, ${row.ai_overall_score},
            ${row.ai_overall_label}, ${row.ai_demand_score}, ${row.ai_demand_summary},
            ${row.ai_margin_score}, ${row.ai_margin_summary}, ${row.ai_labor_score},
            ${row.ai_labor_summary}, ${row.ai_land_score}, ${row.ai_land_summary},
            ${row.ai_confidence_score}, ${row.ai_confidence_summary}, ${row.ai_risk_score},
            ${row.ai_risk_summary}, ${row.ai_trend_narrative}, ${row.ai_scored_at},
            ${row.ai_model_version}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            company_id = EXCLUDED.company_id,
            fiscal_year = EXCLUDED.fiscal_year,
            fiscal_quarter = EXCLUDED.fiscal_quarter,
            source_document_id = EXCLUDED.source_document_id,
            overall_sentiment = EXCLUDED.overall_sentiment,
            confidence_sentiment = EXCLUDED.confidence_sentiment,
            risk_tone_score = EXCLUDED.risk_tone_score,
            demand_tone_score = EXCLUDED.demand_tone_score,
            margin_tone_score = EXCLUDED.margin_tone_score,
            land_tone_score = EXCLUDED.land_tone_score,
            labor_tone_score = EXCLUDED.labor_tone_score,
            ai_overall_score = EXCLUDED.ai_overall_score,
            ai_overall_label = EXCLUDED.ai_overall_label,
            ai_demand_score = EXCLUDED.ai_demand_score,
            ai_demand_summary = EXCLUDED.ai_demand_summary,
            ai_margin_score = EXCLUDED.ai_margin_score,
            ai_margin_summary = EXCLUDED.ai_margin_summary,
            ai_labor_score = EXCLUDED.ai_labor_score,
            ai_labor_summary = EXCLUDED.ai_labor_summary,
            ai_land_score = EXCLUDED.ai_land_score,
            ai_land_summary = EXCLUDED.ai_land_summary,
            ai_confidence_score = EXCLUDED.ai_confidence_score,
            ai_confidence_summary = EXCLUDED.ai_confidence_summary,
            ai_risk_score = EXCLUDED.ai_risk_score,
            ai_risk_summary = EXCLUDED.ai_risk_summary,
            ai_trend_narrative = EXCLUDED.ai_trend_narrative,
            ai_scored_at = EXCLUDED.ai_scored_at,
            ai_model_version = EXCLUDED.ai_model_version,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── sector_sentiment_composite (small, full replace) ──────
  tables.push(
    await snapshotTable(
      "ops_sector_sentiment_composite",
      `SELECT id, fiscal_year, fiscal_quarter, domain, mean_score, builder_count, computed_at
       FROM sector_sentiment_composite`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_sector_sentiment_composite (id, fiscal_year, fiscal_quarter, domain,
            mean_score, builder_count, computed_at, snapshot_date)
          VALUES (${row.id}, ${row.fiscal_year}, ${row.fiscal_quarter}, ${row.domain},
            ${row.mean_score}, ${row.builder_count}, ${row.computed_at}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            fiscal_year = EXCLUDED.fiscal_year,
            fiscal_quarter = EXCLUDED.fiscal_quarter,
            domain = EXCLUDED.domain,
            mean_score = EXCLUDED.mean_score,
            builder_count = EXCLUDED.builder_count,
            computed_at = EXCLUDED.computed_at,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── earnings_calendar ─────────────────────────────────────
  tables.push(
    await snapshotTable(
      "ops_earnings_calendar",
      `SELECT id, company_id, expected_date, fiscal_year, fiscal_quarter, status::text AS status,
              updated_at
       FROM earnings_calendar${incrementalWhere("updated_at", since)}`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_earnings_calendar (id, company_id, expected_date, fiscal_year,
            fiscal_quarter, status, snapshot_date)
          VALUES (${row.id}, ${row.company_id}, ${row.expected_date}, ${row.fiscal_year},
            ${row.fiscal_quarter}, ${row.status}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            company_id = EXCLUDED.company_id,
            expected_date = EXCLUDED.expected_date,
            fiscal_year = EXCLUDED.fiscal_year,
            fiscal_quarter = EXCLUDED.fiscal_quarter,
            status = EXCLUDED.status,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── benchmark_ranges (small, full replace) ────────────────
  tables.push(
    await snapshotTable(
      "ops_benchmark_ranges",
      `SELECT id, metric_key, metric_label, category, low_min, low_max, mid_min, mid_max,
              high_min, high_max, unit, notes
       FROM benchmark_ranges`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_benchmark_ranges (id, metric_key, metric_label, category, low_min,
            low_max, mid_min, mid_max, high_min, high_max, unit, notes, snapshot_date)
          VALUES (${row.id}, ${row.metric_key}, ${row.metric_label}, ${row.category},
            ${row.low_min}, ${row.low_max}, ${row.mid_min}, ${row.mid_max}, ${row.high_min},
            ${row.high_max}, ${row.unit}, ${row.notes}, NOW())
          ON CONFLICT (id) DO UPDATE SET
            metric_key = EXCLUDED.metric_key,
            metric_label = EXCLUDED.metric_label,
            category = EXCLUDED.category,
            low_min = EXCLUDED.low_min,
            low_max = EXCLUDED.low_max,
            mid_min = EXCLUDED.mid_min,
            mid_max = EXCLUDED.mid_max,
            high_min = EXCLUDED.high_min,
            high_max = EXCLUDED.high_max,
            unit = EXCLUDED.unit,
            notes = EXCLUDED.notes,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── source_documents (metadata only — no text_content) ────
  tables.push(
    await snapshotTable(
      "ops_source_documents",
      `SELECT id, company_id, document_type, source_type, doc_date, title, source_url,
              storage_path, metadata_json, created_at
       FROM source_documents${incrementalWhere("created_at", since)}`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_source_documents (id, company_id, document_type, source_type, doc_date,
            title, source_url, storage_path, metadata_json, snapshot_date)
          VALUES (${row.id}, ${row.company_id}, ${row.document_type}, ${row.source_type},
            ${row.doc_date}, ${row.title}, ${row.source_url}, ${row.storage_path},
            ${JSON.stringify(row.metadata_json)}::json, NOW())
          ON CONFLICT (id) DO UPDATE SET
            company_id = EXCLUDED.company_id,
            document_type = EXCLUDED.document_type,
            source_type = EXCLUDED.source_type,
            doc_date = EXCLUDED.doc_date,
            title = EXCLUDED.title,
            source_url = EXCLUDED.source_url,
            storage_path = EXCLUDED.storage_path,
            metadata_json = EXCLUDED.metadata_json,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── filings (MD&A + risk factors only — NOT filing_text) ──
  tables.push(
    await snapshotTable(
      "ops_filings",
      `SELECT id, company_id, filing_type, filing_date, accession_number, filing_url, mdna_text,
              risk_factors_text, created_at
       FROM filings${incrementalWhere("created_at", since)}`,
      async (row) => {
        await db.execute(sql`
          INSERT INTO ops_filings (id, company_id, filing_type, filing_date, accession_number,
            filing_url, mdna_text, risk_factors_text, snapshot_date)
          VALUES (${row.id}, ${row.company_id}, ${row.filing_type}, ${row.filing_date},
            ${row.accession_number}, ${row.filing_url}, ${row.mdna_text}, ${row.risk_factors_text},
            NOW())
          ON CONFLICT (id) DO UPDATE SET
            company_id = EXCLUDED.company_id,
            filing_type = EXCLUDED.filing_type,
            filing_date = EXCLUDED.filing_date,
            accession_number = EXCLUDED.accession_number,
            filing_url = EXCLUDED.filing_url,
            mdna_text = EXCLUDED.mdna_text,
            risk_factors_text = EXCLUDED.risk_factors_text,
            snapshot_date = NOW()
        `);
      }
    )
  );

  // ─── Finalize ──────────────────────────────────────────────
  const totalRowsUpserted = tables.reduce((s, t) => s + t.rowsUpserted, 0);
  const failed = tables.filter((t) => t.error !== null);
  for (const t of failed) errors.push(`${t.table}: ${t.error}`);

  const status: SnapshotPipelineResult["status"] =
    failed.length === 0 ? "success" : failed.length === tables.length ? "failed" : "partial";

  const durationMs = Date.now() - startTime;

  await db.insert(opsSnapshotLog).values({
    id: randomUUID(),
    runFinishedAt: new Date(),
    status,
    tablesJson: tables,
    totalRowsUpserted,
    durationMs,
    errors: errors.length > 0 ? JSON.stringify(errors) : null,
  });

  console.log(
    `[ops-snapshot] Done. status=${status} rows=${totalRowsUpserted} errors=${errors.length} ms=${durationMs}`
  );

  return { status, totalRowsUpserted, durationMs, tables, errors };
}
