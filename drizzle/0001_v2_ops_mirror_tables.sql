-- v2 mirror schema: 16 ops_* tables that hold local snapshots of StrategemOps
-- data, refreshed by /api/cron/ops-snapshot. The user-facing app code only
-- ever queries these tables; never the StrategemOps DB directly.
--
-- Drift note: drizzle-kit also detected v1 schema drift (existing narratives
-- table, idx_occ_geo_year already replaced by idx_occ_geo_year_soc, two
-- columns on demand_capacity_scores already added directly). Those drift
-- statements were stripped from this migration because they describe the
-- live state, not changes to apply. The v1 drift will be reconciled cleanly
-- when v2 wipes the affected tables in task 0.8.
CREATE TABLE "ops_benchmark_ranges" (
	"id" integer PRIMARY KEY NOT NULL,
	"metric_key" text NOT NULL,
	"metric_label" text NOT NULL,
	"category" text NOT NULL,
	"low_min" numeric(18, 4),
	"low_max" numeric(18, 4),
	"mid_min" numeric(18, 4),
	"mid_max" numeric(18, 4),
	"high_min" numeric(18, 4),
	"high_max" numeric(18, 4),
	"unit" text,
	"notes" text,
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_builder_operating_kpis" (
	"id" integer PRIMARY KEY NOT NULL,
	"financial_period_id" integer NOT NULL,
	"homes_ordered" integer,
	"gross_orders" integer,
	"homes_closed" integer,
	"cancellation_rate" numeric(6, 3),
	"backlog_units" integer,
	"backlog_value" numeric(18, 2),
	"active_communities" integer,
	"average_active_communities" numeric(10, 2),
	"average_selling_price" numeric(12, 2),
	"backlog_asp" numeric(12, 2),
	"delivered_asp" numeric(12, 2),
	"lots_owned" integer,
	"lots_controlled" integer,
	"lots_under_contract" integer,
	"mortgage_capture_rate" numeric(6, 3),
	"completed_specs" integer,
	"specs_under_construction" integer,
	"orders_per_community" numeric(8, 3),
	"closings_per_community" numeric(8, 3),
	"backlog_turn_ratio" numeric(8, 3),
	"owned_to_controlled_ratio" numeric(6, 3),
	"completed_spec_risk_ratio" numeric(6, 3),
	"homes_in_inventory" integer,
	"source_doc_id" integer,
	"extraction_method" text,
	"confidence_score" numeric(4, 2),
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_companies" (
	"id" integer PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"company_name" text NOT NULL,
	"cik" text,
	"exchange" text,
	"builder_category" text,
	"fiscal_year_end" text,
	"headquarters" text,
	"ir_url" text,
	"active_status" boolean,
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_company_universe_registry" (
	"id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"builder_100_year" integer NOT NULL,
	"builder_100_rank" integer,
	"public_status" boolean,
	"inclusion_status" text,
	"included_from_date" date,
	"archived_date" date,
	"notes" text,
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_earnings_calendar" (
	"id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"expected_date" date,
	"fiscal_year" integer NOT NULL,
	"fiscal_quarter" integer NOT NULL,
	"status" text,
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_filings" (
	"id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"filing_type" text NOT NULL,
	"filing_date" date NOT NULL,
	"accession_number" text NOT NULL,
	"filing_url" text,
	"mdna_text" text,
	"risk_factors_text" text,
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_financial_facts" (
	"id" integer PRIMARY KEY NOT NULL,
	"financial_period_id" integer NOT NULL,
	"revenue" numeric(18, 2),
	"gross_profit" numeric(18, 2),
	"gross_margin" numeric(8, 4),
	"operating_income" numeric(18, 2),
	"operating_margin" numeric(8, 4),
	"net_income" numeric(18, 2),
	"eps_basic" numeric(10, 4),
	"eps_diluted" numeric(10, 4),
	"total_assets" numeric(18, 2),
	"total_debt" numeric(18, 2),
	"total_equity" numeric(18, 2),
	"cash_and_equivalents" numeric(18, 2),
	"operating_cash_flow" numeric(18, 2),
	"capex" numeric(18, 2),
	"free_cash_flow" numeric(18, 2),
	"homebuilding_revenue" numeric(18, 2),
	"financial_services_income" numeric(18, 2),
	"stock_price_at_report" numeric(12, 4),
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_financial_periods" (
	"id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"period_type" text,
	"fiscal_year" integer NOT NULL,
	"fiscal_quarter" integer,
	"period_start" date,
	"period_end" date,
	"filing_date" date,
	"accession_number" text,
	"source_priority" text,
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_incentive_tracking" (
	"id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"financial_period_id" integer,
	"incentives_pct_revenue" numeric(6, 3),
	"buydown_offered" boolean,
	"buydown_rate" numeric(6, 4),
	"source" text,
	"notes" text,
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_innovation_theme_mentions" (
	"id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"fiscal_year" integer NOT NULL,
	"fiscal_quarter" integer,
	"theme_name" text NOT NULL,
	"mention_count" integer,
	"weighted_score" numeric(8, 4),
	"example_snippets_json" json,
	"source_document_id" integer,
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_management_narratives" (
	"id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"fiscal_year" integer NOT NULL,
	"fiscal_quarter" integer,
	"source_document_id" integer,
	"narrative_type" text,
	"prepared_remarks_text" text,
	"qa_text" text,
	"full_text" text,
	"source_method" text,
	"confidence_score" numeric(4, 2),
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_sector_sentiment_composite" (
	"id" integer PRIMARY KEY NOT NULL,
	"fiscal_year" integer NOT NULL,
	"fiscal_quarter" integer NOT NULL,
	"domain" text NOT NULL,
	"mean_score" numeric(6, 3),
	"builder_count" integer,
	"computed_at" timestamp,
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_sentiment_scores" (
	"id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"fiscal_year" integer NOT NULL,
	"fiscal_quarter" integer,
	"source_document_id" integer,
	"overall_sentiment" numeric(6, 3),
	"confidence_sentiment" numeric(6, 3),
	"risk_tone_score" numeric(6, 3),
	"demand_tone_score" numeric(6, 3),
	"margin_tone_score" numeric(6, 3),
	"land_tone_score" numeric(6, 3),
	"labor_tone_score" numeric(6, 3),
	"ai_overall_score" numeric(6, 3),
	"ai_overall_label" text,
	"ai_demand_score" numeric(6, 3),
	"ai_demand_summary" text,
	"ai_margin_score" numeric(6, 3),
	"ai_margin_summary" text,
	"ai_labor_score" numeric(6, 3),
	"ai_labor_summary" text,
	"ai_land_score" numeric(6, 3),
	"ai_land_summary" text,
	"ai_confidence_score" numeric(6, 3),
	"ai_confidence_summary" text,
	"ai_risk_score" numeric(6, 3),
	"ai_risk_summary" text,
	"ai_trend_narrative" text,
	"ai_scored_at" timestamp,
	"ai_model_version" text,
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_snapshot_log" (
	"id" text PRIMARY KEY NOT NULL,
	"run_started_at" timestamp DEFAULT now() NOT NULL,
	"run_finished_at" timestamp,
	"status" text NOT NULL,
	"tables_json" json,
	"total_rows_upserted" integer DEFAULT 0,
	"duration_ms" integer,
	"errors" text
);
--> statement-breakpoint
CREATE TABLE "ops_source_documents" (
	"id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"source_type" text NOT NULL,
	"doc_date" date,
	"title" text,
	"source_url" text,
	"storage_path" text,
	"metadata_json" json,
	"snapshot_date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_ops_fp_company" ON "ops_financial_periods" USING btree ("company_id","fiscal_year","fiscal_quarter");--> statement-breakpoint
CREATE INDEX "idx_ops_snapshot_log_started" ON "ops_snapshot_log" USING btree ("run_started_at");