-- v2: market_narratives
--
-- One row per (geography, snapshot_date) holding two LLM-generated
-- blurbs that narrate the underlying data. Refreshed monthly by the
-- dedicated market-narratives cron. Rendered in the /heatmap popup
-- (Portfolio Health blurb) and the /markets/[id] drilldown page
-- (both blurbs).
--
-- The LLM prompt is strict: describe the inputs, never recommend,
-- never editorialize. The blurb narrates the score; it doesn't
-- pick a direction. That's the board-room-defensibility line.

CREATE TABLE "market_narratives" (
  "id" text PRIMARY KEY NOT NULL,
  "geography_id" text NOT NULL REFERENCES "geographies"("id") ON DELETE CASCADE,
  "snapshot_date" date NOT NULL,
  "portfolio_health_blurb" text,
  "market_opportunity_blurb" text,
  "model" text DEFAULT 'gpt-4.1' NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_market_narratives_geo_date" ON "market_narratives" ("geography_id", "snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_market_narratives_geo" ON "market_narratives" ("geography_id");
