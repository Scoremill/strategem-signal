import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  date,
  timestamp,
  doublePrecision,
  decimal,
  json,
  index,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Geographies (Master MSA table) ─────────────────────────────
export const geographies = pgTable("geographies", {
  id: text("id").primaryKey(), // UUID
  cbsaFips: text("cbsa_fips").notNull().unique(),
  name: text("name").notNull(), // e.g. "Dallas-Fort Worth-Arlington, TX"
  shortName: text("short_name").notNull(), // e.g. "Dallas-Fort Worth"
  state: text("state").notNull(), // primary state abbreviation
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  population: integer("population"), // latest Census estimate
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Demand-Side Data ────────────────────────────────────────────

// Census Building Permits — monthly
export const permitData = pgTable(
  "permit_data",
  {
    id: text("id").primaryKey(),
    geographyId: text("geography_id").notNull().references(() => geographies.id),
    periodDate: date("period_date").notNull(), // first of month
    totalPermits: integer("total_permits").notNull(),
    singleFamily: integer("single_family"),
    multiFamily: integer("multi_family"),
    yoyChangePct: decimal("yoy_change_pct", { precision: 6, scale: 2 }),
    source: text("source").default("census_permits").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_permit_geo_date").on(table.geographyId, table.periodDate),
  ]
);

// BLS CES/LAUS Employment — monthly
export const employmentData = pgTable(
  "employment_data",
  {
    id: text("id").primaryKey(),
    geographyId: text("geography_id").notNull().references(() => geographies.id),
    periodDate: date("period_date").notNull(),
    totalNonfarm: integer("total_nonfarm"), // total nonfarm employment
    constructionEmployment: integer("construction_employment"),
    unemploymentRate: decimal("unemployment_rate", { precision: 4, scale: 1 }),
    momChangePct: decimal("mom_change_pct", { precision: 6, scale: 2 }),
    yoyChangePct: decimal("yoy_change_pct", { precision: 6, scale: 2 }),
    source: text("source").default("bls_ces").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_employment_geo_date").on(table.geographyId, table.periodDate),
  ]
);

// Census Population / IRS SOI Migration — annual
export const migrationData = pgTable(
  "migration_data",
  {
    id: text("id").primaryKey(),
    geographyId: text("geography_id").notNull().references(() => geographies.id),
    year: integer("year").notNull(),
    netDomesticMigration: integer("net_domestic_migration"),
    netInternationalMigration: integer("net_international_migration"),
    totalPopulation: integer("total_population"),
    populationChangePct: decimal("population_change_pct", { precision: 6, scale: 2 }),
    source: text("source").default("census_pop").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_migration_geo_year").on(table.geographyId, table.year),
  ]
);

// Census ACS Household Income — annual
export const incomeData = pgTable(
  "income_data",
  {
    id: text("id").primaryKey(),
    geographyId: text("geography_id").notNull().references(() => geographies.id),
    year: integer("year").notNull(),
    medianHouseholdIncome: integer("median_household_income"),
    meanHouseholdIncome: integer("mean_household_income"),
    yoyChangePct: decimal("yoy_change_pct", { precision: 6, scale: 2 }),
    source: text("source").default("census_acs").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_income_geo_year").on(table.geographyId, table.year),
  ]
);

// Census Housing Starts — monthly
export const housingStarts = pgTable(
  "housing_starts",
  {
    id: text("id").primaryKey(),
    geographyId: text("geography_id").notNull().references(() => geographies.id),
    periodDate: date("period_date").notNull(),
    totalStarts: integer("total_starts"),
    singleFamilyStarts: integer("single_family_starts"),
    yoyChangePct: decimal("yoy_change_pct", { precision: 6, scale: 2 }),
    source: text("source").default("census_starts").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_starts_geo_date").on(table.geographyId, table.periodDate),
  ]
);

// ─── Capacity-Side Data ──────────────────────────────────────────

// BLS QCEW — quarterly trade employment and wages (NAICS 2381-2389)
export const tradeCapacityData = pgTable(
  "trade_capacity_data",
  {
    id: text("id").primaryKey(),
    geographyId: text("geography_id").notNull().references(() => geographies.id),
    periodDate: date("period_date").notNull(), // quarter-end date
    naicsCode: text("naics_code").notNull(), // "2381", "2382", "2383", or "238x" aggregate
    naicsDescription: text("naics_description"),
    avgMonthlyEmployment: integer("avg_monthly_employment").notNull(),
    totalQuarterlyWages: bigint("total_quarterly_wages", { mode: "number" }),
    avgWeeklyWage: decimal("avg_weekly_wage", { precision: 8, scale: 2 }),
    establishmentCount: integer("establishment_count"),
    wageYoyChangePct: decimal("wage_yoy_change_pct", { precision: 6, scale: 2 }),
    employmentYoyChangePct: decimal("employment_yoy_change_pct", { precision: 6, scale: 2 }),
    source: text("source").default("bls_qcew").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_trade_geo_date").on(table.geographyId, table.periodDate),
    index("idx_trade_naics").on(table.naicsCode),
  ]
);

// BLS OES — annual occupation-level detail (SOC 47-xxxx)
export const occupationData = pgTable(
  "occupation_data",
  {
    id: text("id").primaryKey(),
    geographyId: text("geography_id").notNull().references(() => geographies.id),
    vintageYear: integer("vintage_year").notNull(),
    socCode: text("soc_code").notNull(), // e.g. "47-2031" (carpenters)
    socTitle: text("soc_title").notNull(),
    employment: integer("employment"),
    medianHourlyWage: decimal("median_hourly_wage", { precision: 8, scale: 2 }),
    meanAnnualWage: decimal("mean_annual_wage", { precision: 10, scale: 2 }),
    wageYoyChangePct: decimal("wage_yoy_change_pct", { precision: 6, scale: 2 }),
    source: text("source").default("bls_oes").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_occ_geo_year_soc").on(table.geographyId, table.vintageYear, table.socCode),
    index("idx_occ_soc").on(table.socCode),
  ]
);

// Census C30 — monthly/quarterly construction spending
export const constructionSpending = pgTable(
  "construction_spending",
  {
    id: text("id").primaryKey(),
    geographyId: text("geography_id").notNull().references(() => geographies.id),
    periodDate: date("period_date").notNull(),
    totalConstructionValue: bigint("total_construction_value", { mode: "number" }),
    residentialValue: bigint("residential_value", { mode: "number" }),
    nonresidentialValue: bigint("nonresidential_value", { mode: "number" }),
    source: text("source").default("census_c30").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_spending_geo_date").on(table.geographyId, table.periodDate),
  ]
);

// ─── Computed Scores ─────────────────────────────────────────────
//
// Removed in v2 Phase 0.7: demand_scores, capacity_scores, demand_capacity_scores.
// The v1 composite Demand-Capacity Ratio was the wrong analytical model
// (collapses six independent filters into one number; hides which filter
// is failing). Phase 2 of v2 replaces it with per-filter scoring against
// the six CEO requirement filters, each carrying its own 0-100 score
// and a clickable source-traceability drill-down. The corresponding
// database tables get DROPped in Phase 0.8.

// ─── Users & Auth ────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  role: text("role").default("user").notNull(), // "user" | "admin"
  subscriptionStatus: text("subscription_status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Cached Narratives ───────────────────────────────────────────
//
// Removed in v2 Phase 0.7. The v1 narratives table held LLM-generated
// market and portfolio summaries that synthesized the composite scoring
// without exposing the underlying reasoning chain. That contradicts the
// CEO requirement that every insight be traceable to its source data.
// Phase 4 of v2 rebuilds AI commentary with full source attribution per
// claim. The corresponding database table gets DROPped in Phase 0.8.

// ─── Pipeline Logs ───────────────────────────────────────────────

export const fetchLogs = pgTable("fetch_logs", {
  id: text("id").primaryKey(),
  pipeline: text("pipeline").notNull(), // "permits", "employment", "qcew", etc.
  runAt: timestamp("run_at").defaultNow().notNull(),
  recordsFetched: integer("records_fetched").default(0),
  recordsNew: integer("records_new").default(0),
  errors: text("errors"), // JSON array
  durationMs: integer("duration_ms"),
});

// ─── StrategemOps Mirror Tables (ops_*) ─────────────────────────
//
// These tables are LOCAL COPIES of StrategemOps data, refreshed by the
// monthly snapshot job at /api/cron/ops-snapshot. The user-facing app code
// only ever queries these mirror tables — never the StrategemOps DB directly.
// This isolates the cross-database concern to one job and keeps app latency
// independent of StrategemOps availability.
//
// Schema rules:
//  - Same column names and shapes as the StrategemOps source tables
//  - All Postgres ENUMs in StrategemOps become plain text here so we don't
//    have to keep enum definitions in sync between the two databases
//  - Every row carries snapshot_date so we can show data freshness in the UI
//  - Primary key matches the source row's id (allows clean upsert by id)
//  - StrategemOps source: project curly-mud-45701913, role strategem_signal_reader

// Public homebuilder roster (StrategemOps companies)
export const opsCompanies = pgTable("ops_companies", {
  id: integer("id").primaryKey(),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  cik: text("cik"),
  exchange: text("exchange"),
  builderCategory: text("builder_category"),
  fiscalYearEnd: text("fiscal_year_end"),
  headquarters: text("headquarters"),
  irUrl: text("ir_url"),
  activeStatus: boolean("active_status"),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// Builder 100 inclusion / coverage list
export const opsCompanyUniverseRegistry = pgTable("ops_company_universe_registry", {
  id: integer("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  builder100Year: integer("builder_100_year").notNull(),
  builder100Rank: integer("builder_100_rank"),
  publicStatus: boolean("public_status"),
  inclusionStatus: text("inclusion_status"),
  includedFromDate: date("included_from_date"),
  archivedDate: date("archived_date"),
  notes: text("notes"),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// Quarterly fiscal periods per company
export const opsFinancialPeriods = pgTable("ops_financial_periods", {
  id: integer("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  periodType: text("period_type"),
  fiscalYear: integer("fiscal_year").notNull(),
  fiscalQuarter: integer("fiscal_quarter"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  filingDate: date("filing_date"),
  accessionNumber: text("accession_number"),
  sourcePriority: text("source_priority"),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
}, (table) => [
  index("idx_ops_fp_company").on(table.companyId, table.fiscalYear, table.fiscalQuarter),
]);

// Quarterly financial line items (revenue, margin, cash flow, etc.)
export const opsFinancialFacts = pgTable("ops_financial_facts", {
  id: integer("id").primaryKey(),
  financialPeriodId: integer("financial_period_id").notNull(),
  revenue: decimal("revenue", { precision: 18, scale: 2 }),
  grossProfit: decimal("gross_profit", { precision: 18, scale: 2 }),
  grossMargin: decimal("gross_margin", { precision: 8, scale: 4 }),
  operatingIncome: decimal("operating_income", { precision: 18, scale: 2 }),
  operatingMargin: decimal("operating_margin", { precision: 8, scale: 4 }),
  netIncome: decimal("net_income", { precision: 18, scale: 2 }),
  epsBasic: decimal("eps_basic", { precision: 10, scale: 4 }),
  epsDiluted: decimal("eps_diluted", { precision: 10, scale: 4 }),
  totalAssets: decimal("total_assets", { precision: 18, scale: 2 }),
  totalDebt: decimal("total_debt", { precision: 18, scale: 2 }),
  totalEquity: decimal("total_equity", { precision: 18, scale: 2 }),
  cashAndEquivalents: decimal("cash_and_equivalents", { precision: 18, scale: 2 }),
  operatingCashFlow: decimal("operating_cash_flow", { precision: 18, scale: 2 }),
  capex: decimal("capex", { precision: 18, scale: 2 }),
  freeCashFlow: decimal("free_cash_flow", { precision: 18, scale: 2 }),
  homebuildingRevenue: decimal("homebuilding_revenue", { precision: 18, scale: 2 }),
  financialServicesIncome: decimal("financial_services_income", { precision: 18, scale: 2 }),
  stockPriceAtReport: decimal("stock_price_at_report", { precision: 12, scale: 4 }),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// Quarterly operating KPIs (closings, ASP, lots, backlog, etc.)
export const opsBuilderOperatingKpis = pgTable("ops_builder_operating_kpis", {
  id: integer("id").primaryKey(),
  financialPeriodId: integer("financial_period_id").notNull(),
  homesOrdered: integer("homes_ordered"),
  grossOrders: integer("gross_orders"),
  homesClosed: integer("homes_closed"),
  cancellationRate: decimal("cancellation_rate", { precision: 6, scale: 3 }),
  backlogUnits: integer("backlog_units"),
  backlogValue: decimal("backlog_value", { precision: 18, scale: 2 }),
  activeCommunities: integer("active_communities"),
  averageActiveCommunities: decimal("average_active_communities", { precision: 10, scale: 2 }),
  averageSellingPrice: decimal("average_selling_price", { precision: 12, scale: 2 }),
  backlogAsp: decimal("backlog_asp", { precision: 12, scale: 2 }),
  deliveredAsp: decimal("delivered_asp", { precision: 12, scale: 2 }),
  lotsOwned: integer("lots_owned"),
  lotsControlled: integer("lots_controlled"),
  lotsUnderContract: integer("lots_under_contract"),
  mortgageCaptureRate: decimal("mortgage_capture_rate", { precision: 6, scale: 3 }),
  completedSpecs: integer("completed_specs"),
  specsUnderConstruction: integer("specs_under_construction"),
  ordersPerCommunity: decimal("orders_per_community", { precision: 8, scale: 3 }),
  closingsPerCommunity: decimal("closings_per_community", { precision: 8, scale: 3 }),
  backlogTurnRatio: decimal("backlog_turn_ratio", { precision: 8, scale: 3 }),
  ownedToControlledRatio: decimal("owned_to_controlled_ratio", { precision: 6, scale: 3 }),
  completedSpecRiskRatio: decimal("completed_spec_risk_ratio", { precision: 6, scale: 3 }),
  homesInInventory: integer("homes_in_inventory"),
  sourceDocId: integer("source_doc_id"),
  extractionMethod: text("extraction_method"),
  confidenceScore: decimal("confidence_score", { precision: 4, scale: 2 }),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// Quarterly incentive % of revenue + buydown activity
export const opsIncentiveTracking = pgTable("ops_incentive_tracking", {
  id: integer("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  financialPeriodId: integer("financial_period_id"),
  incentivesPctRevenue: decimal("incentives_pct_revenue", { precision: 6, scale: 3 }),
  buydownOffered: boolean("buydown_offered"),
  buydownRate: decimal("buydown_rate", { precision: 6, scale: 4 }),
  source: text("source"),
  notes: text("notes"),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// Earnings call prepared remarks + Q&A text
export const opsManagementNarratives = pgTable("ops_management_narratives", {
  id: integer("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  fiscalYear: integer("fiscal_year").notNull(),
  fiscalQuarter: integer("fiscal_quarter"),
  sourceDocumentId: integer("source_document_id"),
  narrativeType: text("narrative_type"),
  preparedRemarksText: text("prepared_remarks_text"),
  qaText: text("qa_text"),
  fullText: text("full_text"),
  sourceMethod: text("source_method"),
  confidenceScore: decimal("confidence_score", { precision: 4, scale: 2 }),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// Innovation / theme mentions per builder per period
export const opsInnovationThemeMentions = pgTable("ops_innovation_theme_mentions", {
  id: integer("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  fiscalYear: integer("fiscal_year").notNull(),
  fiscalQuarter: integer("fiscal_quarter"),
  themeName: text("theme_name").notNull(),
  mentionCount: integer("mention_count"),
  weightedScore: decimal("weighted_score", { precision: 8, scale: 4 }),
  exampleSnippetsJson: json("example_snippets_json"),
  sourceDocumentId: integer("source_document_id"),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// Per-builder per-quarter sentiment (raw + AI-scored)
export const opsSentimentScores = pgTable("ops_sentiment_scores", {
  id: integer("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  fiscalYear: integer("fiscal_year").notNull(),
  fiscalQuarter: integer("fiscal_quarter"),
  sourceDocumentId: integer("source_document_id"),
  overallSentiment: decimal("overall_sentiment", { precision: 6, scale: 3 }),
  confidenceSentiment: decimal("confidence_sentiment", { precision: 6, scale: 3 }),
  riskToneScore: decimal("risk_tone_score", { precision: 6, scale: 3 }),
  demandToneScore: decimal("demand_tone_score", { precision: 6, scale: 3 }),
  marginToneScore: decimal("margin_tone_score", { precision: 6, scale: 3 }),
  landToneScore: decimal("land_tone_score", { precision: 6, scale: 3 }),
  laborToneScore: decimal("labor_tone_score", { precision: 6, scale: 3 }),
  aiOverallScore: decimal("ai_overall_score", { precision: 6, scale: 3 }),
  aiOverallLabel: text("ai_overall_label"),
  aiDemandScore: decimal("ai_demand_score", { precision: 6, scale: 3 }),
  aiDemandSummary: text("ai_demand_summary"),
  aiMarginScore: decimal("ai_margin_score", { precision: 6, scale: 3 }),
  aiMarginSummary: text("ai_margin_summary"),
  aiLaborScore: decimal("ai_labor_score", { precision: 6, scale: 3 }),
  aiLaborSummary: text("ai_labor_summary"),
  aiLandScore: decimal("ai_land_score", { precision: 6, scale: 3 }),
  aiLandSummary: text("ai_land_summary"),
  aiConfidenceScore: decimal("ai_confidence_score", { precision: 6, scale: 3 }),
  aiConfidenceSummary: text("ai_confidence_summary"),
  aiRiskScore: decimal("ai_risk_score", { precision: 6, scale: 3 }),
  aiRiskSummary: text("ai_risk_summary"),
  aiTrendNarrative: text("ai_trend_narrative"),
  aiScoredAt: timestamp("ai_scored_at"),
  aiModelVersion: text("ai_model_version"),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// Sector-wide sentiment composite per period
export const opsSectorSentimentComposite = pgTable("ops_sector_sentiment_composite", {
  id: integer("id").primaryKey(),
  fiscalYear: integer("fiscal_year").notNull(),
  fiscalQuarter: integer("fiscal_quarter").notNull(),
  domain: text("domain").notNull(),
  meanScore: decimal("mean_score", { precision: 6, scale: 3 }),
  builderCount: integer("builder_count"),
  computedAt: timestamp("computed_at"),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// Earnings calendar (next earnings dates per builder)
export const opsEarningsCalendar = pgTable("ops_earnings_calendar", {
  id: integer("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  expectedDate: date("expected_date"),
  fiscalYear: integer("fiscal_year").notNull(),
  fiscalQuarter: integer("fiscal_quarter").notNull(),
  status: text("status"),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// Comparative ranges per metric (low/mid/high bands)
export const opsBenchmarkRanges = pgTable("ops_benchmark_ranges", {
  id: integer("id").primaryKey(),
  metricKey: text("metric_key").notNull(),
  metricLabel: text("metric_label").notNull(),
  category: text("category").notNull(),
  lowMin: decimal("low_min", { precision: 18, scale: 4 }),
  lowMax: decimal("low_max", { precision: 18, scale: 4 }),
  midMin: decimal("mid_min", { precision: 18, scale: 4 }),
  midMax: decimal("mid_max", { precision: 18, scale: 4 }),
  highMin: decimal("high_min", { precision: 18, scale: 4 }),
  highMax: decimal("high_max", { precision: 18, scale: 4 }),
  unit: text("unit"),
  notes: text("notes"),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// Source documents (10-K, 10-Q, earnings call transcripts) — minus heavy text fields
// We mirror metadata + URLs only; raw filing text stays in StrategemOps to keep
// our snapshot fast and our DB small.
export const opsSourceDocuments = pgTable("ops_source_documents", {
  id: integer("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  documentType: text("document_type").notNull(),
  sourceType: text("source_type").notNull(),
  docDate: date("doc_date"),
  title: text("title"),
  sourceUrl: text("source_url"),
  storagePath: text("storage_path"),
  metadataJson: json("metadata_json"),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// SEC filings (10-K, 10-Q, 8-K) — metadata + MD&A + risk factors only.
// filing_text and exhibits_index_json stay in StrategemOps.
export const opsFilings = pgTable("ops_filings", {
  id: integer("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  filingType: text("filing_type").notNull(),
  filingDate: date("filing_date").notNull(),
  accessionNumber: text("accession_number").notNull(),
  filingUrl: text("filing_url"),
  mdnaText: text("mdna_text"),
  riskFactorsText: text("risk_factors_text"),
  snapshotDate: timestamp("snapshot_date").defaultNow().notNull(),
});

// Snapshot run log — written by /api/cron/ops-snapshot on every run.
// Powers the daily self-heal retry workflow and the freshness indicator
// in the UI ("Benchmark data as of [snapshot_date]").
export const opsSnapshotLog = pgTable("ops_snapshot_log", {
  id: text("id").primaryKey(), // UUID
  runStartedAt: timestamp("run_started_at").defaultNow().notNull(),
  runFinishedAt: timestamp("run_finished_at"),
  // 'success' = all tables landed; 'partial' = some failed; 'failed' = none landed
  status: text("status").notNull(),
  // JSON blob with per-table { rows_fetched, rows_upserted, error } records
  tablesJson: json("tables_json"),
  totalRowsUpserted: integer("total_rows_upserted").default(0),
  durationMs: integer("duration_ms"),
  errors: text("errors"),
}, (table) => [
  index("idx_ops_snapshot_log_started").on(table.runStartedAt),
]);

// ─── Type Exports ────────────────────────────────────────────────

export type Geography = typeof geographies.$inferSelect;
export type PermitData = typeof permitData.$inferSelect;
export type EmploymentData = typeof employmentData.$inferSelect;
export type MigrationData = typeof migrationData.$inferSelect;
export type IncomeData = typeof incomeData.$inferSelect;
export type TradeCapacityData = typeof tradeCapacityData.$inferSelect;
export type OccupationData = typeof occupationData.$inferSelect;
export type User = typeof users.$inferSelect;
export type FetchLog = typeof fetchLogs.$inferSelect;
