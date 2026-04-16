-- v2 Phase 1.0: tracked_markets becomes user-scoped (personal filter)
--
-- Every user in an org manages their own filter of MSAs to follow. The
-- Portfolio Health View scores only the markets in the current user's
-- filter. org_id stays on the row so it still cascades with the org and
-- participates in the tenantQuery isolation layer, but uniqueness and
-- ownership move to (user_id, geography_id).
--
-- The v2 app has not shipped yet so the table is empty in production;
-- the NOT NULL add needs no backfill. The old `added_by` column is
-- dropped in favor of the new required user_id.

ALTER TABLE "tracked_markets" ADD COLUMN "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tracked_markets" DROP COLUMN IF EXISTS "added_by";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_tracked_markets_org_geo";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tracked_markets_user_geo" ON "tracked_markets" ("user_id", "geography_id");--> statement-breakpoint
CREATE INDEX "idx_tracked_markets_user" ON "tracked_markets" ("user_id");
