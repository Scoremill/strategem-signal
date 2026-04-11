CREATE TABLE "capacity_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"geography_id" text NOT NULL,
	"score_date" date NOT NULL,
	"trade_employment_score" numeric(5, 2),
	"wage_acceleration_score" numeric(5, 2),
	"establishment_score" numeric(5, 2),
	"permits_per_worker_score" numeric(5, 2),
	"dollars_per_worker_score" numeric(5, 2),
	"capacity_index" numeric(6, 2) NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "construction_spending" (
	"id" text PRIMARY KEY NOT NULL,
	"geography_id" text NOT NULL,
	"period_date" date NOT NULL,
	"total_construction_value" bigint,
	"residential_value" bigint,
	"nonresidential_value" bigint,
	"source" text DEFAULT 'census_c30' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_capacity_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"geography_id" text NOT NULL,
	"score_date" date NOT NULL,
	"demand_index" numeric(6, 2) NOT NULL,
	"capacity_index" numeric(6, 2) NOT NULL,
	"demand_capacity_ratio" numeric(8, 3) NOT NULL,
	"status" text NOT NULL,
	"velocity_3m_demand" numeric(6, 2),
	"velocity_6m_demand" numeric(6, 2),
	"velocity_12m_demand" numeric(6, 2),
	"velocity_3m_capacity" numeric(6, 2),
	"velocity_6m_capacity" numeric(6, 2),
	"velocity_12m_capacity" numeric(6, 2),
	"velocity_3m_ratio" numeric(6, 3),
	"velocity_6m_ratio" numeric(6, 3),
	"velocity_12m_ratio" numeric(6, 3),
	"demand_percentile_rank" numeric(5, 2),
	"capacity_percentile_rank" numeric(5, 2),
	"ratio_percentile_rank" numeric(5, 2),
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"geography_id" text NOT NULL,
	"score_date" date NOT NULL,
	"permit_score" numeric(5, 2),
	"employment_score" numeric(5, 2),
	"migration_score" numeric(5, 2),
	"income_score" numeric(5, 2),
	"starts_score" numeric(5, 2),
	"demand_index" numeric(6, 2) NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employment_data" (
	"id" text PRIMARY KEY NOT NULL,
	"geography_id" text NOT NULL,
	"period_date" date NOT NULL,
	"total_nonfarm" integer,
	"construction_employment" integer,
	"unemployment_rate" numeric(4, 1),
	"mom_change_pct" numeric(6, 2),
	"yoy_change_pct" numeric(6, 2),
	"source" text DEFAULT 'bls_ces' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline" text NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"records_fetched" integer DEFAULT 0,
	"records_new" integer DEFAULT 0,
	"errors" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "geographies" (
	"id" text PRIMARY KEY NOT NULL,
	"cbsa_fips" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"state" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"population" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "geographies_cbsa_fips_unique" UNIQUE("cbsa_fips")
);
--> statement-breakpoint
CREATE TABLE "housing_starts" (
	"id" text PRIMARY KEY NOT NULL,
	"geography_id" text NOT NULL,
	"period_date" date NOT NULL,
	"total_starts" integer,
	"single_family_starts" integer,
	"yoy_change_pct" numeric(6, 2),
	"source" text DEFAULT 'census_starts' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_data" (
	"id" text PRIMARY KEY NOT NULL,
	"geography_id" text NOT NULL,
	"year" integer NOT NULL,
	"median_household_income" integer,
	"mean_household_income" integer,
	"yoy_change_pct" numeric(6, 2),
	"source" text DEFAULT 'census_acs' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_data" (
	"id" text PRIMARY KEY NOT NULL,
	"geography_id" text NOT NULL,
	"year" integer NOT NULL,
	"net_domestic_migration" integer,
	"net_international_migration" integer,
	"total_population" integer,
	"population_change_pct" numeric(6, 2),
	"source" text DEFAULT 'census_pop' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occupation_data" (
	"id" text PRIMARY KEY NOT NULL,
	"geography_id" text NOT NULL,
	"vintage_year" integer NOT NULL,
	"soc_code" text NOT NULL,
	"soc_title" text NOT NULL,
	"employment" integer,
	"median_hourly_wage" numeric(8, 2),
	"mean_annual_wage" numeric(10, 2),
	"wage_yoy_change_pct" numeric(6, 2),
	"source" text DEFAULT 'bls_oes' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permit_data" (
	"id" text PRIMARY KEY NOT NULL,
	"geography_id" text NOT NULL,
	"period_date" date NOT NULL,
	"total_permits" integer NOT NULL,
	"single_family" integer,
	"multi_family" integer,
	"yoy_change_pct" numeric(6, 2),
	"source" text DEFAULT 'census_permits' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_capacity_data" (
	"id" text PRIMARY KEY NOT NULL,
	"geography_id" text NOT NULL,
	"period_date" date NOT NULL,
	"naics_code" text NOT NULL,
	"naics_description" text,
	"avg_monthly_employment" integer NOT NULL,
	"total_quarterly_wages" bigint,
	"avg_weekly_wage" numeric(8, 2),
	"establishment_count" integer,
	"wage_yoy_change_pct" numeric(6, 2),
	"employment_yoy_change_pct" numeric(6, 2),
	"source" text DEFAULT 'bls_qcew' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'user' NOT NULL,
	"subscription_status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "capacity_scores" ADD CONSTRAINT "capacity_scores_geography_id_geographies_id_fk" FOREIGN KEY ("geography_id") REFERENCES "public"."geographies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_spending" ADD CONSTRAINT "construction_spending_geography_id_geographies_id_fk" FOREIGN KEY ("geography_id") REFERENCES "public"."geographies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_capacity_scores" ADD CONSTRAINT "demand_capacity_scores_geography_id_geographies_id_fk" FOREIGN KEY ("geography_id") REFERENCES "public"."geographies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_scores" ADD CONSTRAINT "demand_scores_geography_id_geographies_id_fk" FOREIGN KEY ("geography_id") REFERENCES "public"."geographies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_data" ADD CONSTRAINT "employment_data_geography_id_geographies_id_fk" FOREIGN KEY ("geography_id") REFERENCES "public"."geographies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housing_starts" ADD CONSTRAINT "housing_starts_geography_id_geographies_id_fk" FOREIGN KEY ("geography_id") REFERENCES "public"."geographies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_data" ADD CONSTRAINT "income_data_geography_id_geographies_id_fk" FOREIGN KEY ("geography_id") REFERENCES "public"."geographies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_data" ADD CONSTRAINT "migration_data_geography_id_geographies_id_fk" FOREIGN KEY ("geography_id") REFERENCES "public"."geographies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occupation_data" ADD CONSTRAINT "occupation_data_geography_id_geographies_id_fk" FOREIGN KEY ("geography_id") REFERENCES "public"."geographies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_data" ADD CONSTRAINT "permit_data_geography_id_geographies_id_fk" FOREIGN KEY ("geography_id") REFERENCES "public"."geographies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_capacity_data" ADD CONSTRAINT "trade_capacity_data_geography_id_geographies_id_fk" FOREIGN KEY ("geography_id") REFERENCES "public"."geographies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_capacity_geo_date" ON "capacity_scores" USING btree ("geography_id","score_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_spending_geo_date" ON "construction_spending" USING btree ("geography_id","period_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dc_geo_date" ON "demand_capacity_scores" USING btree ("geography_id","score_date");--> statement-breakpoint
CREATE INDEX "idx_dc_status" ON "demand_capacity_scores" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_demand_geo_date" ON "demand_scores" USING btree ("geography_id","score_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_employment_geo_date" ON "employment_data" USING btree ("geography_id","period_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_starts_geo_date" ON "housing_starts" USING btree ("geography_id","period_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_income_geo_year" ON "income_data" USING btree ("geography_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_migration_geo_year" ON "migration_data" USING btree ("geography_id","year");--> statement-breakpoint
CREATE INDEX "idx_occ_geo_year" ON "occupation_data" USING btree ("geography_id","vintage_year");--> statement-breakpoint
CREATE INDEX "idx_occ_soc" ON "occupation_data" USING btree ("soc_code");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_permit_geo_date" ON "permit_data" USING btree ("geography_id","period_date");--> statement-breakpoint
CREATE INDEX "idx_trade_geo_date" ON "trade_capacity_data" USING btree ("geography_id","period_date");--> statement-breakpoint
CREATE INDEX "idx_trade_naics" ON "trade_capacity_data" USING btree ("naics_code");