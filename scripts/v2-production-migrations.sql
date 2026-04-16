-- StrategemSignal v2 → main merge migrations
--
-- Run these against the main production branch of the StrategemSignal
-- Neon project (fancy-mountain-71820151) BEFORE merging v2 to main.
-- The v2 app will 500 on every page if these are missing.
--
-- All five statements are idempotent (IF NOT EXISTS) so they're safe
-- to re-run. Ordered so foreign-key references resolve (geographies
-- must already exist; all five reference it).

-- ── 1. Zillow ZHVI ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zillow_zhvi (
    id text PRIMARY KEY,
    geography_id text NOT NULL REFERENCES geographies(id) ON DELETE CASCADE,
    period_date date NOT NULL,
    median_home_value integer NOT NULL,
    source text NOT NULL DEFAULT 'zillow_zhvi_metro',
    fetched_at timestamp NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_zillow_zhvi_geo_period ON zillow_zhvi (geography_id, period_date);
CREATE INDEX IF NOT EXISTS idx_zillow_zhvi_geo ON zillow_zhvi (geography_id);

-- ── 2. FHFA HPI ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fhfa_hpi (
    id text PRIMARY KEY,
    geography_id text NOT NULL REFERENCES geographies(id) ON DELETE CASCADE,
    year integer NOT NULL,
    quarter integer NOT NULL,
    hpi numeric(8, 2) NOT NULL,
    hpi_yoy_change_pct numeric(6, 2),
    source text NOT NULL DEFAULT 'fhfa_metro',
    fetched_at timestamp NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fhfa_hpi_geo_period ON fhfa_hpi (geography_id, year, quarter);
CREATE INDEX IF NOT EXISTS idx_fhfa_hpi_geo ON fhfa_hpi (geography_id);

-- ── 3. Portfolio Health Snapshots ─────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio_health_snapshots (
    id text PRIMARY KEY,
    geography_id text NOT NULL REFERENCES geographies(id) ON DELETE CASCADE,
    snapshot_date date NOT NULL,
    financial_score numeric(5, 2),
    demand_score numeric(5, 2),
    operational_score numeric(5, 2),
    composite_score numeric(5, 2),
    inputs_json json,
    created_at timestamp NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_health_geo_date ON portfolio_health_snapshots (geography_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_portfolio_health_date ON portfolio_health_snapshots (snapshot_date);

-- ── 4. Market Opportunity Scores ──────────────────────────────────
CREATE TABLE IF NOT EXISTS market_opportunity_scores (
    id text PRIMARY KEY,
    geography_id text NOT NULL REFERENCES geographies(id) ON DELETE CASCADE,
    snapshot_date date NOT NULL,
    filter_1_migration numeric(5, 2),
    filter_2_diversity numeric(5, 2),
    filter_3_imbalance numeric(5, 2),
    filter_4_competitive numeric(5, 2),
    filter_5_affordability numeric(5, 2),
    filter_6_operational numeric(5, 2),
    num_green integer NOT NULL DEFAULT 0,
    all_six_green boolean NOT NULL DEFAULT false,
    inputs_json json,
    created_at timestamp NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_opp_geo_date ON market_opportunity_scores (geography_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_market_opp_date ON market_opportunity_scores (snapshot_date);
CREATE INDEX IF NOT EXISTS idx_market_opp_num_green ON market_opportunity_scores (num_green);

-- ── 5. Market Narratives ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_narratives (
    id text PRIMARY KEY,
    geography_id text NOT NULL REFERENCES geographies(id) ON DELETE CASCADE,
    snapshot_date date NOT NULL,
    portfolio_health_blurb text,
    market_opportunity_blurb text,
    model text NOT NULL DEFAULT 'gpt-4.1',
    generated_at timestamp NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_narratives_geo_date ON market_narratives (geography_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_market_narratives_geo ON market_narratives (geography_id);

-- ── Done ──────────────────────────────────────────────────────────
-- After these run, the v2 app has every table its code imports. The
-- tables will be empty — the first cron runs (permits, capacity,
-- Zillow, FHFA, portfolio-health, market-opportunity, narratives) will
-- populate them on their next scheduled firings.
--
-- If you want production to have data before waiting a month, you can
-- manually trigger each cron through the GitHub Actions "Run workflow"
-- button for workflow_dispatch — every workflow in .github/workflows/
-- is configured to allow manual runs.
