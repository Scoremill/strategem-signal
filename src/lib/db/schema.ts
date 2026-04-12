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
    index("idx_occ_geo_year").on(table.geographyId, table.vintageYear),
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

// Demand scores — blended demand index per MSA per period
export const demandScores = pgTable(
  "demand_scores",
  {
    id: text("id").primaryKey(),
    geographyId: text("geography_id").notNull().references(() => geographies.id),
    scoreDate: date("score_date").notNull(),
    permitScore: decimal("permit_score", { precision: 5, scale: 2 }),
    employmentScore: decimal("employment_score", { precision: 5, scale: 2 }),
    migrationScore: decimal("migration_score", { precision: 5, scale: 2 }),
    incomeScore: decimal("income_score", { precision: 5, scale: 2 }),
    startsScore: decimal("starts_score", { precision: 5, scale: 2 }),
    demandIndex: decimal("demand_index", { precision: 6, scale: 2 }).notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_demand_geo_date").on(table.geographyId, table.scoreDate),
  ]
);

// Capacity scores — blended capacity index per MSA per period
export const capacityScores = pgTable(
  "capacity_scores",
  {
    id: text("id").primaryKey(),
    geographyId: text("geography_id").notNull().references(() => geographies.id),
    scoreDate: date("score_date").notNull(),
    tradeEmploymentScore: decimal("trade_employment_score", { precision: 5, scale: 2 }),
    wageAccelerationScore: decimal("wage_acceleration_score", { precision: 5, scale: 2 }),
    establishmentScore: decimal("establishment_score", { precision: 5, scale: 2 }),
    permitsPerWorkerScore: decimal("permits_per_worker_score", { precision: 5, scale: 2 }),
    dollarsPerWorkerScore: decimal("dollars_per_worker_score", { precision: 5, scale: 2 }),
    capacityIndex: decimal("capacity_index", { precision: 6, scale: 2 }).notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_capacity_geo_date").on(table.geographyId, table.scoreDate),
  ]
);

// Master demand-capacity scores — the core metric table
export const demandCapacityScores = pgTable(
  "demand_capacity_scores",
  {
    id: text("id").primaryKey(),
    geographyId: text("geography_id").notNull().references(() => geographies.id),
    scoreDate: date("score_date").notNull(),
    demandIndex: decimal("demand_index", { precision: 6, scale: 2 }).notNull(),
    capacityIndex: decimal("capacity_index", { precision: 6, scale: 2 }).notNull(),
    demandCapacityRatio: decimal("demand_capacity_ratio", { precision: 8, scale: 3 }).notNull(),
    // Status: "constrained" (>1.15), "equilibrium" (0.85-1.15), "favorable" (<0.85)
    status: text("status").notNull(),
    // Velocity — rate of change over time windows
    velocity3mDemand: decimal("velocity_3m_demand", { precision: 6, scale: 2 }),
    velocity6mDemand: decimal("velocity_6m_demand", { precision: 6, scale: 2 }),
    velocity12mDemand: decimal("velocity_12m_demand", { precision: 6, scale: 2 }),
    velocity3mCapacity: decimal("velocity_3m_capacity", { precision: 6, scale: 2 }),
    velocity6mCapacity: decimal("velocity_6m_capacity", { precision: 6, scale: 2 }),
    velocity12mCapacity: decimal("velocity_12m_capacity", { precision: 6, scale: 2 }),
    velocity3mRatio: decimal("velocity_3m_ratio", { precision: 6, scale: 3 }),
    velocity6mRatio: decimal("velocity_6m_ratio", { precision: 6, scale: 3 }),
    velocity12mRatio: decimal("velocity_12m_ratio", { precision: 6, scale: 3 }),
    // Trade Availability: workers per permit adjusted for wage pressure
    tradeAvailability: decimal("trade_availability", { precision: 8, scale: 2 }),
    // Estimated Monthly Starts: derived from permit volume × regional conversion factor
    estMonthlyStarts: integer("est_monthly_starts"),
    // Percentile rankings across all MSAs
    demandPercentileRank: decimal("demand_percentile_rank", { precision: 5, scale: 2 }),
    capacityPercentileRank: decimal("capacity_percentile_rank", { precision: 5, scale: 2 }),
    ratioPercentileRank: decimal("ratio_percentile_rank", { precision: 5, scale: 2 }),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_dc_geo_date").on(table.geographyId, table.scoreDate),
    index("idx_dc_status").on(table.status),
  ]
);

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

export const narratives = pgTable(
  "narratives",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(), // "market", "portfolio", "capacity"
    geographyId: text("geography_id"), // null for portfolio-level
    fullNarrative: text("full_narrative"), // long version
    snippet: text("snippet"), // short version (for popups)
    metadata: text("metadata"), // JSON — topPicks, watchList, implications, etc.
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_narratives_type_geo").on(table.type, table.geographyId),
  ]
);

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

// ─── Type Exports ────────────────────────────────────────────────

export type Geography = typeof geographies.$inferSelect;
export type PermitData = typeof permitData.$inferSelect;
export type EmploymentData = typeof employmentData.$inferSelect;
export type MigrationData = typeof migrationData.$inferSelect;
export type IncomeData = typeof incomeData.$inferSelect;
export type TradeCapacityData = typeof tradeCapacityData.$inferSelect;
export type OccupationData = typeof occupationData.$inferSelect;
export type DemandCapacityScore = typeof demandCapacityScores.$inferSelect;
export type User = typeof users.$inferSelect;
export type FetchLog = typeof fetchLogs.$inferSelect;
