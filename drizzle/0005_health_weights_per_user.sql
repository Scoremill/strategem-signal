-- v2 Phase 1.3: health_score_weights becomes per-user
--
-- Same rationale as Phase 1.0 (tracked_markets → per-user): each user in
-- an org picks their own weighting profile. A CEO weighting affordability
-- heavily and a COO weighting operational feasibility in the same market
-- should each see their own composite score.
--
-- The v2 app has not shipped; the table is empty. Drop and recreate rather
-- than migrate in place.

DROP TABLE IF EXISTS "health_score_weights";--> statement-breakpoint
CREATE TABLE "health_score_weights" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "weight_financial" numeric(4,3) DEFAULT '0.400' NOT NULL,
  "weight_demand" numeric(4,3) DEFAULT '0.300' NOT NULL,
  "weight_operational" numeric(4,3) DEFAULT '0.300' NOT NULL,
  "preset_name" text DEFAULT 'balanced' NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "org_id")
);
