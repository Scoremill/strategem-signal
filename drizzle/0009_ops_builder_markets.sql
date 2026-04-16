-- v2 Filter 4: ops_builder_markets
--
-- Derived table produced by an LLM parser that extracts public-builder
-- market mentions from ops_management_narratives and resolves them to
-- CBSA geographies. NOT a mirror of a StrategemOps table — we build it
-- ourselves from existing mirror data and store it on StrategemSignal.
--
-- Feeds Phase 2 Filter 4 (Competitive Landscape) and the Phase 3
-- acquisition entry model.

CREATE TABLE "ops_builder_markets" (
  "id" text PRIMARY KEY NOT NULL,
  "builder_ticker" text NOT NULL,
  "geography_id" text NOT NULL REFERENCES "geographies"("id") ON DELETE CASCADE,
  "mention_count" integer DEFAULT 1 NOT NULL,
  "first_seen_year" integer,
  "last_seen_year" integer,
  "source_ids" json,
  "confidence" text DEFAULT 'medium' NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ops_builder_markets_bt_geo" ON "ops_builder_markets" ("builder_ticker", "geography_id");--> statement-breakpoint
CREATE INDEX "idx_ops_builder_markets_geo" ON "ops_builder_markets" ("geography_id");--> statement-breakpoint
CREATE INDEX "idx_ops_builder_markets_ticker" ON "ops_builder_markets" ("builder_ticker");
