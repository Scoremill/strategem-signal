-- v2 Phase 0.9: multi-tenant foundation
--
-- Drops the v1 single-user `users` table and replaces it with the v2
-- multi-tenant set: orgs, users (new shape), org_memberships, tracked_markets,
-- watchlist_markets, health_score_weights, flags, business_cases,
-- alert_preferences, alerts, audit_log. Plus the org_role enum.
--
-- This file documents what was applied directly via Neon MCP during the
-- v2 rebuild. It is NOT idempotent — the live DB already has all of these
-- objects. Future agents working from a fresh Neon branch should run this
-- file as-is.

-- v1 single-user users table (zero rows, no FK references, safe to drop)
DROP TABLE IF EXISTS "users";--> statement-breakpoint

-- Role enum used by org_memberships.role
CREATE TYPE "org_role" AS ENUM ('owner', 'ceo', 'cfo', 'coo', 'division_president', 'member');--> statement-breakpoint

-- Customer organizations
CREATE TABLE "orgs" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "subscription_status" text DEFAULT 'trial' NOT NULL,
  "trial_ends_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Users — identity is separate from org membership
CREATE TABLE "users" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "name" text,
  "email_verified_at" timestamp,
  "last_login_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Joins users to orgs with a role
CREATE TABLE "org_memberships" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "role" "org_role" NOT NULL,
  "invited_by" text REFERENCES "users"("id"),
  "invited_at" timestamp,
  "joined_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_org_memberships_user_org" ON "org_memberships" ("user_id", "org_id");--> statement-breakpoint
CREATE INDEX "idx_org_memberships_org" ON "org_memberships" ("org_id");--> statement-breakpoint

-- Tracked markets — actively monitored MSAs per org.
-- NOTE: Phase 1.0 (migration 0003) converts this to a per-USER filter:
-- adds user_id NOT NULL, drops added_by, moves uniqueness to (user_id,
-- geography_id). This original block reflects the pre-1.0 shape for
-- historical accuracy — see 0003_tracked_markets_user_scoped.sql for
-- the current shape.
CREATE TABLE "tracked_markets" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "geography_id" text NOT NULL REFERENCES "geographies"("id"),
  "added_by" text REFERENCES "users"("id"),
  "added_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tracked_markets_org_geo" ON "tracked_markets" ("org_id", "geography_id");--> statement-breakpoint
CREATE INDEX "idx_tracked_markets_org" ON "tracked_markets" ("org_id");--> statement-breakpoint

-- Watchlist markets — candidates the org is considering
CREATE TABLE "watchlist_markets" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "geography_id" text NOT NULL REFERENCES "geographies"("id"),
  "added_by" text REFERENCES "users"("id"),
  "notes" text,
  "added_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_watchlist_markets_org_geo" ON "watchlist_markets" ("org_id", "geography_id");--> statement-breakpoint
CREATE INDEX "idx_watchlist_markets_org" ON "watchlist_markets" ("org_id");--> statement-breakpoint

-- Per-org health score weighting (Financial / Demand / Operational sub-scores)
CREATE TABLE "health_score_weights" (
  "org_id" text PRIMARY KEY REFERENCES "orgs"("id") ON DELETE CASCADE,
  "weight_financial" numeric(4, 3) DEFAULT 0.400 NOT NULL,
  "weight_demand" numeric(4, 3) DEFAULT 0.300 NOT NULL,
  "weight_operational" numeric(4, 3) DEFAULT 0.300 NOT NULL,
  "updated_by" text REFERENCES "users"("id"),
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Flags — markets a user has flagged with a personal note for follow-up
CREATE TABLE "flags" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "geography_id" text NOT NULL REFERENCES "geographies"("id"),
  "flagged_by" text NOT NULL REFERENCES "users"("id"),
  "note" text,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp
);--> statement-breakpoint
CREATE INDEX "idx_flags_org" ON "flags" ("org_id");--> statement-breakpoint
CREATE INDEX "idx_flags_org_geo" ON "flags" ("org_id", "geography_id");--> statement-breakpoint

-- Business cases — saved organic/acquisition entry models from Phase 3
CREATE TABLE "business_cases" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "geography_id" text NOT NULL REFERENCES "geographies"("id"),
  "case_type" text NOT NULL,
  "title" text NOT NULL,
  "inputs_json" json,
  "outputs_json" json,
  "recommendation" text,
  "created_by" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "idx_business_cases_org" ON "business_cases" ("org_id");--> statement-breakpoint

-- Per-user alert delivery preferences (cadence, email enabled)
CREATE TABLE "alert_preferences" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "cadence" text DEFAULT 'weekly' NOT NULL,
  "email_enabled" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_alert_prefs_user_org" ON "alert_preferences" ("user_id", "org_id");--> statement-breakpoint

-- Alerts — actual alert events fired by the Phase 4 signal detection service
CREATE TABLE "alerts" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "geography_id" text REFERENCES "geographies"("id"),
  "alert_type" text NOT NULL,
  "severity" text DEFAULT 'info' NOT NULL,
  "decision_text" text NOT NULL,
  "payload_json" json,
  "acknowledged_by" text REFERENCES "users"("id"),
  "acknowledged_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "idx_alerts_org" ON "alerts" ("org_id");--> statement-breakpoint
CREATE INDEX "idx_alerts_org_created" ON "alerts" ("org_id", "created_at");--> statement-breakpoint

-- Audit log — every settings change for board-defense compliance
CREATE TABLE "audit_log" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "user_id" text REFERENCES "users"("id"),
  "action" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "before_json" json,
  "after_json" json,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "idx_audit_log_org_created" ON "audit_log" ("org_id", "created_at");
