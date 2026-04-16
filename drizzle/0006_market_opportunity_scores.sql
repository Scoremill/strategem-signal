-- v2 Phase 2.8: market_opportunity_scores
--
-- One row per market per snapshot run. Output of the Phase 2 six-filter
-- market opportunity scan. Written monthly by /api/cron/market-opportunity,
-- read by /opportunities. Shared across all tenants.
--
-- Two filters (4 Competitive and 5 Affordability) are stubbed in the
-- initial Phase 2 ship and will return null scores. The columns exist
-- so lighting up the stubs later is a pipeline change, not a schema
-- migration.

CREATE TABLE "market_opportunity_scores" (
  "id" text PRIMARY KEY NOT NULL,
  "geography_id" text NOT NULL REFERENCES "geographies"("id") ON DELETE CASCADE,
  "snapshot_date" date NOT NULL,
  "filter_1_migration" numeric(5,2),
  "filter_2_diversity" numeric(5,2),
  "filter_3_imbalance" numeric(5,2),
  "filter_4_competitive" numeric(5,2),
  "filter_5_affordability" numeric(5,2),
  "filter_6_operational" numeric(5,2),
  "num_green" integer DEFAULT 0 NOT NULL,
  "all_six_green" boolean DEFAULT false NOT NULL,
  "inputs_json" json,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_market_opp_geo_date" ON "market_opportunity_scores" ("geography_id", "snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_market_opp_date" ON "market_opportunity_scores" ("snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_market_opp_num_green" ON "market_opportunity_scores" ("num_green");
