-- v2 Phase 3.1: zillow_zhvi
--
-- Metro-level median home value (dollars) from Zillow Home Value Index.
-- Feeds the Phase 3 Organic Entry Model — we need real dollar prices
-- (not an index) to compute land basis per unit.
--
-- Source: https://files.zillowstatic.com/research/public_csvs/zhvi/
--   Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv
-- Monthly, ~894 metros, back to 2000. Refreshed the 15th of each month.

CREATE TABLE "zillow_zhvi" (
  "id" text PRIMARY KEY NOT NULL,
  "geography_id" text NOT NULL REFERENCES "geographies"("id") ON DELETE CASCADE,
  "period_date" date NOT NULL,
  "median_home_value" integer NOT NULL,
  "source" text DEFAULT 'zillow_zhvi_metro' NOT NULL,
  "fetched_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_zillow_zhvi_geo_period" ON "zillow_zhvi" ("geography_id", "period_date");--> statement-breakpoint
CREATE INDEX "idx_zillow_zhvi_geo" ON "zillow_zhvi" ("geography_id");
