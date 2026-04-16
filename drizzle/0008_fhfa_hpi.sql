-- v2 Pre-Phase-3: FHFA House Price Index
--
-- Quarterly home price index per metro. Source is the FHFA metro CSV
-- at https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_metro.csv
-- Covers 410 metros going back to 1975.
--
-- Filter 5 (Affordability Runway) and the Phase 3 Organic Entry Model
-- both depend on this. The monthly cron backfills the latest quarter
-- going forward; scripts/backfill-fhfa.ts seeds 2023Q1-2025Q4 history.

CREATE TABLE "fhfa_hpi" (
  "id" text PRIMARY KEY NOT NULL,
  "geography_id" text NOT NULL REFERENCES "geographies"("id") ON DELETE CASCADE,
  "year" integer NOT NULL,
  "quarter" integer NOT NULL,
  "hpi" numeric(8, 2) NOT NULL,
  "hpi_yoy_change_pct" numeric(6, 2),
  "source" text DEFAULT 'fhfa_metro' NOT NULL,
  "fetched_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_fhfa_hpi_geo_period" ON "fhfa_hpi" ("geography_id", "year", "quarter");--> statement-breakpoint
CREATE INDEX "idx_fhfa_hpi_geo" ON "fhfa_hpi" ("geography_id");
