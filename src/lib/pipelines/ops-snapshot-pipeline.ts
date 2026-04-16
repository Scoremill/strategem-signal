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
 *  - **Bulk upserts in batches of 500 rows per INSERT statement.** This is
 *    critical for the Vercel Hobby 300s function cap. Per-row inserts on
 *    7,773 rows took ~13 minutes; bulk brings it under 90 seconds.
 *  - Idempotent: re-running the pipeline immediately is safe; the daily
 *    self-heal cron relies on this.
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

const BATCH_SIZE = 500;

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
  const row = (rows as unknown as { rows?: Array<{ last: string | null }> }).rows?.[0]
    ?? (Array.isArray(rows) ? (rows as Array<{ last: string | null }>)[0] : undefined);
  if (!row?.last) return null;
  return new Date(row.last);
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
 * Configuration for a single table snapshot. `columns` is the ORDERED list of
 * destination column names (excluding snapshot_date — that's always added).
 * `selectSql` returns rows whose object keys match `columns` exactly.
 */
interface TableConfig {
  destTable: string;
  columns: string[];
  jsonColumns?: string[]; // columns whose values must be JSON.stringify'd before bind
  selectSql: string;
}

/**
 * Bulk upsert rows into a destination table in batches of BATCH_SIZE. One
 * round-trip per batch instead of one per row. Uses positional parameters so
 * Postgres parses the statement once per batch.
 *
 * The ON CONFLICT clause updates every column from EXCLUDED, so re-running
 * the snapshot writes the latest values without losing any history (we
 * never delete from mirror tables).
 */
async function bulkUpsert(
  destTable: string,
  columns: string[],
  rows: Record<string, unknown>[],
  jsonColumns?: string[]
): Promise<number> {
  if (rows.length === 0) return 0;

  let upserted = 0;
  const jsonSet = new Set(jsonColumns ?? []);
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const updateSet = columns
    .filter((c) => c !== "id")
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(", ");

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const params: unknown[] = [];
    const valuePlaceholders: string[] = [];

    for (const row of batch) {
      const rowPlaceholders: string[] = [];
      for (const col of columns) {
        const raw = row[col];
        const value = jsonSet.has(col) && raw != null ? JSON.stringify(raw) : raw;
        params.push(value ?? null);
        rowPlaceholders.push(`$${params.length}`);
      }
      // snapshot_date is added as NOW() outside the parameter list
      valuePlaceholders.push(`(${rowPlaceholders.join(", ")}, NOW())`);
    }

    const stmt =
      `INSERT INTO "${destTable}" (${colList}, "snapshot_date") ` +
      `VALUES ${valuePlaceholders.join(", ")} ` +
      `ON CONFLICT (id) DO UPDATE SET ${updateSet}, "snapshot_date" = NOW()`;

    try {
      await db.execute(sql.raw(buildParameterizedSql(stmt, params)));
      upserted += batch.length;
    } catch (err) {
      // If a whole batch fails, fall back to per-row so one bad row doesn't
      // kill the entire batch. Slow path, but only happens on actual errors.
      console.warn(`[ops-snapshot] bulk upsert failed for ${destTable} batch, falling back per-row:`, err);
      for (const row of batch) {
        try {
          const rowParams: unknown[] = [];
          const rowPlaceholders: string[] = [];
          for (const col of columns) {
            const raw = row[col];
            const value = jsonSet.has(col) && raw != null ? JSON.stringify(raw) : raw;
            rowParams.push(value ?? null);
            rowPlaceholders.push(`$${rowParams.length}`);
          }
          const rowStmt =
            `INSERT INTO "${destTable}" (${colList}, "snapshot_date") ` +
            `VALUES (${rowPlaceholders.join(", ")}, NOW()) ` +
            `ON CONFLICT (id) DO UPDATE SET ${updateSet}, "snapshot_date" = NOW()`;
          await db.execute(sql.raw(buildParameterizedSql(rowStmt, rowParams)));
          upserted++;
        } catch (rowErr) {
          console.warn(`[ops-snapshot] ${destTable} row id=${row.id} failed:`, rowErr);
        }
      }
    }
  }

  return upserted;
}

/**
 * Inline parameter binding helper. drizzle's sql.raw() doesn't support $N
 * placeholders, and the neon-http driver's db.execute doesn't accept a
 * params array. So we substitute params into the SQL string ourselves with
 * proper escaping. This is safe because all parameters originate from
 * StrategemOps (a trusted internal database we control) — no user input
 * touches this path.
 */
function buildParameterizedSql(stmt: string, params: unknown[]): string {
  return stmt.replace(/\$(\d+)/g, (_match, n) => {
    const idx = parseInt(n, 10) - 1;
    return formatSqlValue(params[idx]);
  });
}

function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  // String, including JSON-stringified objects. Escape single quotes by doubling.
  const s = String(value).replace(/'/g, "''");
  return `'${s}'`;
}

/**
 * Snapshot a single source table using bulk upsert.
 */
async function snapshotTable(config: TableConfig): Promise<TableSnapshotResult> {
  const startTime = Date.now();
  const result: TableSnapshotResult = {
    table: config.destTable,
    rowsFetched: 0,
    rowsUpserted: 0,
    durationMs: 0,
    error: null,
  };

  try {
    const ops = getOpsClient();
    const rows = (await ops.query(config.selectSql)) as unknown as Record<string, unknown>[];
    result.rowsFetched = rows.length;
    result.rowsUpserted = await bulkUpsert(
      config.destTable,
      config.columns,
      rows,
      config.jsonColumns
    );
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

/**
 * Build the per-table configuration list. Each config drives one bulk snapshot.
 * Column lists must match the ops_* mirror table column order exactly (minus
 * snapshot_date, which bulkUpsert adds via NOW()).
 */
function buildTableConfigs(since: Date | null): TableConfig[] {
  const inc = (col: string) => incrementalWhere(col, since);

  return [
    {
      destTable: "ops_companies",
      columns: ["id", "ticker", "company_name", "cik", "exchange", "builder_category",
                "fiscal_year_end", "headquarters", "ir_url", "active_status"],
      selectSql:
        `SELECT id, ticker, company_name, cik, exchange, builder_category::text AS builder_category,
                fiscal_year_end, headquarters, ir_url, active_status
         FROM companies${inc("updated_at")}`,
    },
    {
      destTable: "ops_company_universe_registry",
      columns: ["id", "company_id", "builder_100_year", "builder_100_rank", "public_status",
                "inclusion_status", "included_from_date", "archived_date", "notes"],
      selectSql:
        `SELECT id, company_id, builder_100_year, builder_100_rank, public_status,
                inclusion_status::text AS inclusion_status, included_from_date, archived_date, notes
         FROM company_universe_registry${inc("created_at")}`,
    },
    {
      destTable: "ops_financial_periods",
      columns: ["id", "company_id", "period_type", "fiscal_year", "fiscal_quarter",
                "period_start", "period_end", "filing_date", "accession_number", "source_priority"],
      selectSql:
        `SELECT id, company_id, period_type::text AS period_type, fiscal_year, fiscal_quarter,
                period_start, period_end, filing_date, accession_number, source_priority
         FROM financial_periods${inc("updated_at")}`,
    },
    {
      destTable: "ops_financial_facts",
      columns: ["id", "financial_period_id", "revenue", "gross_profit", "gross_margin",
                "operating_income", "operating_margin", "net_income", "eps_basic", "eps_diluted",
                "total_assets", "total_debt", "total_equity", "cash_and_equivalents",
                "operating_cash_flow", "capex", "free_cash_flow", "homebuilding_revenue",
                "financial_services_income", "stock_price_at_report"],
      selectSql:
        `SELECT id, financial_period_id, revenue, gross_profit, gross_margin, operating_income,
                operating_margin, net_income, eps_basic, eps_diluted, total_assets, total_debt,
                total_equity, cash_and_equivalents, operating_cash_flow, capex, free_cash_flow,
                homebuilding_revenue, financial_services_income, stock_price_at_report
         FROM financial_facts${inc("updated_at")}`,
    },
    {
      destTable: "ops_builder_operating_kpis",
      columns: ["id", "financial_period_id", "homes_ordered", "gross_orders", "homes_closed",
                "cancellation_rate", "backlog_units", "backlog_value", "active_communities",
                "average_active_communities", "average_selling_price", "backlog_asp", "delivered_asp",
                "lots_owned", "lots_controlled", "lots_under_contract", "mortgage_capture_rate",
                "completed_specs", "specs_under_construction", "orders_per_community",
                "closings_per_community", "backlog_turn_ratio", "owned_to_controlled_ratio",
                "completed_spec_risk_ratio", "homes_in_inventory", "source_doc_id",
                "extraction_method", "confidence_score"],
      selectSql:
        `SELECT id, financial_period_id, homes_ordered, gross_orders, homes_closed,
                cancellation_rate, backlog_units, backlog_value, active_communities,
                average_active_communities, average_selling_price, backlog_asp, delivered_asp,
                lots_owned, lots_controlled, lots_under_contract, mortgage_capture_rate,
                completed_specs, specs_under_construction, orders_per_community,
                closings_per_community, backlog_turn_ratio, owned_to_controlled_ratio,
                completed_spec_risk_ratio, homes_in_inventory, source_doc_id, extraction_method,
                confidence_score
         FROM builder_operating_kpis${inc("updated_at")}`,
    },
    {
      destTable: "ops_incentive_tracking",
      columns: ["id", "company_id", "financial_period_id", "incentives_pct_revenue",
                "buydown_offered", "buydown_rate", "source", "notes"],
      selectSql:
        `SELECT id, company_id, financial_period_id, incentives_pct_revenue, buydown_offered,
                buydown_rate, source, notes
         FROM incentive_tracking${inc("created_at")}`,
    },
    {
      destTable: "ops_management_narratives",
      columns: ["id", "company_id", "fiscal_year", "fiscal_quarter", "source_document_id",
                "narrative_type", "prepared_remarks_text", "qa_text", "full_text",
                "source_method", "confidence_score"],
      selectSql:
        `SELECT id, company_id, fiscal_year, fiscal_quarter, source_document_id,
                narrative_type::text AS narrative_type, prepared_remarks_text, qa_text, full_text,
                source_method, confidence_score
         FROM management_narratives${inc("created_at")}`,
    },
    {
      destTable: "ops_innovation_theme_mentions",
      columns: ["id", "company_id", "fiscal_year", "fiscal_quarter", "theme_name",
                "mention_count", "weighted_score", "example_snippets_json", "source_document_id"],
      jsonColumns: ["example_snippets_json"],
      selectSql:
        `SELECT id, company_id, fiscal_year, fiscal_quarter, theme_name, mention_count,
                weighted_score, example_snippets_json, source_document_id
         FROM innovation_theme_mentions${inc("created_at")}`,
    },
    {
      destTable: "ops_sentiment_scores",
      columns: ["id", "company_id", "fiscal_year", "fiscal_quarter", "source_document_id",
                "overall_sentiment", "confidence_sentiment", "risk_tone_score", "demand_tone_score",
                "margin_tone_score", "land_tone_score", "labor_tone_score", "ai_overall_score",
                "ai_overall_label", "ai_demand_score", "ai_demand_summary", "ai_margin_score",
                "ai_margin_summary", "ai_labor_score", "ai_labor_summary", "ai_land_score",
                "ai_land_summary", "ai_confidence_score", "ai_confidence_summary", "ai_risk_score",
                "ai_risk_summary", "ai_trend_narrative", "ai_scored_at", "ai_model_version"],
      selectSql:
        `SELECT id, company_id, fiscal_year, fiscal_quarter, source_document_id, overall_sentiment,
                confidence_sentiment, risk_tone_score, demand_tone_score, margin_tone_score,
                land_tone_score, labor_tone_score, ai_overall_score, ai_overall_label,
                ai_demand_score, ai_demand_summary, ai_margin_score, ai_margin_summary,
                ai_labor_score, ai_labor_summary, ai_land_score, ai_land_summary,
                ai_confidence_score, ai_confidence_summary, ai_risk_score, ai_risk_summary,
                ai_trend_narrative, ai_scored_at, ai_model_version
         FROM sentiment_scores${inc("created_at")}`,
    },
    {
      destTable: "ops_sector_sentiment_composite",
      columns: ["id", "fiscal_year", "fiscal_quarter", "domain", "mean_score", "builder_count",
                "computed_at"],
      selectSql:
        `SELECT id, fiscal_year, fiscal_quarter, domain, mean_score, builder_count, computed_at
         FROM sector_sentiment_composite`,
    },
    {
      destTable: "ops_earnings_calendar",
      columns: ["id", "company_id", "expected_date", "fiscal_year", "fiscal_quarter", "status"],
      selectSql:
        `SELECT id, company_id, expected_date, fiscal_year, fiscal_quarter, status::text AS status
         FROM earnings_calendar${inc("updated_at")}`,
    },
    {
      destTable: "ops_benchmark_ranges",
      columns: ["id", "metric_key", "metric_label", "category", "low_min", "low_max", "mid_min",
                "mid_max", "high_min", "high_max", "unit", "notes"],
      selectSql:
        `SELECT id, metric_key, metric_label, category, low_min, low_max, mid_min, mid_max,
                high_min, high_max, unit, notes
         FROM benchmark_ranges`,
    },
    {
      destTable: "ops_source_documents",
      columns: ["id", "company_id", "document_type", "source_type", "doc_date", "title",
                "source_url", "storage_path", "metadata_json"],
      jsonColumns: ["metadata_json"],
      selectSql:
        `SELECT id, company_id, document_type, source_type, doc_date, title, source_url,
                storage_path, metadata_json
         FROM source_documents${inc("created_at")}`,
    },
    {
      destTable: "ops_filings",
      columns: ["id", "company_id", "filing_type", "filing_date", "accession_number", "filing_url",
                "mdna_text", "risk_factors_text"],
      selectSql:
        `SELECT id, company_id, filing_type, filing_date, accession_number, filing_url, mdna_text,
                risk_factors_text
         FROM filings${inc("created_at")}`,
    },
  ];
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

  const configs = buildTableConfigs(since);
  for (const config of configs) {
    const result = await snapshotTable(config);
    tables.push(result);
    console.log(
      `[ops-snapshot] ${config.destTable}: fetched=${result.rowsFetched} ` +
      `upserted=${result.rowsUpserted} ${result.durationMs}ms` +
      (result.error ? ` ERROR: ${result.error}` : "")
    );
  }

  // Finalize
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
