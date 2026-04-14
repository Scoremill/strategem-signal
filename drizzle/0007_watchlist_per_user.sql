-- v2 Phase 2.11: watchlist_markets becomes user-scoped
--
-- Same rationale as Phase 1.0 (tracked_markets → per-user) and Phase 1.3
-- (health_score_weights → per-user). Each user in an org maintains their
-- own watchlist; two users in the same org can independently flag the
-- same market.
--
-- Table was empty (no watchlist writes in Phase 0 or Phase 1), so drop
-- and recreate rather than ALTER.

DROP TABLE IF EXISTS "watchlist_markets";--> statement-breakpoint
CREATE TABLE "watchlist_markets" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "geography_id" text NOT NULL REFERENCES "geographies"("id"),
  "notes" text,
  "added_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_watchlist_markets_user_geo" ON "watchlist_markets" ("user_id", "geography_id");--> statement-breakpoint
CREATE INDEX "idx_watchlist_markets_user" ON "watchlist_markets" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_watchlist_markets_org" ON "watchlist_markets" ("org_id");
