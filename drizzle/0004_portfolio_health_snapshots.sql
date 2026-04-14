-- v2 Phase 1.2: portfolio_health_snapshots
--
-- One row per market per snapshot run. Written by /api/cron/portfolio-health
-- (monthly), read by the Portfolio Health View in Phase 1.4+. Shared across
-- tenants: the score for a market is identical regardless of who's looking
-- at it. Per-user weighting in 1.3 re-blends the stored sub-scores client-
-- side, so the server only stores the three raw sub-scores plus the composite
-- at the default 40/30/30 weighting.

CREATE TABLE "portfolio_health_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "geography_id" text NOT NULL REFERENCES "geographies"("id") ON DELETE CASCADE,
  "snapshot_date" date NOT NULL,
  "financial_score" numeric(5,2),
  "demand_score" numeric(5,2),
  "operational_score" numeric(5,2),
  "composite_score" numeric(5,2),
  "inputs_json" json,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_portfolio_health_geo_date" ON "portfolio_health_snapshots" ("geography_id", "snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_portfolio_health_date" ON "portfolio_health_snapshots" ("snapshot_date");
