/**
 * Copy v2-preview data → main production.
 *
 * One-off migration run after the v2-to-main merge. Copies derived
 * federal data and user state from the `v2-preview` Neon branch to
 * the default (main production) branch so the app has fresh data
 * on day one instead of waiting for the next cron cycle.
 *
 * Tables copied (FK order):
 *   - users (UPSERT — same UUID already exists, but sync email-verified
 *     / password-hash in case they diverged)
 *   - ops_builder_markets
 *   - zillow_zhvi
 *   - fhfa_hpi
 *   - portfolio_health_snapshots
 *   - market_opportunity_scores
 *   - market_narratives
 *   - tracked_markets
 *   - health_score_weights
 *   - business_cases
 *
 * Usage:
 *   DATABASE_URL=<main-prod> SOURCE_DATABASE_URL=<v2-preview> \
 *     npx tsx scripts/copy-v2-preview-to-production.ts
 */
import { neon } from "@neondatabase/serverless";

const DEST = process.env.DATABASE_URL;
const SOURCE = process.env.SOURCE_DATABASE_URL;

if (!DEST || !SOURCE) {
  console.error(
    "Required env: DATABASE_URL (destination) and SOURCE_DATABASE_URL (v2-preview).",
  );
  process.exit(1);
}

const dest = neon(DEST);
const src = neon(SOURCE);

const BATCH = 200;

async function countOnBoth(table: string): Promise<{ src: number; dst: number }> {
  const s = (await src.query(`SELECT COUNT(*)::int AS c FROM ${table}`)) as Array<{ c: number }>;
  const d = (await dest.query(`SELECT COUNT(*)::int AS c FROM ${table}`)) as Array<{ c: number }>;
  return { src: s[0].c, dst: d[0].c };
}

async function copyTable(
  table: string,
  columns: string[],
  conflictClause: string,
): Promise<number> {
  console.log(`\n── ${table} ──`);
  const { src: srcCount, dst: dstBefore } = await countOnBoth(table);
  console.log(`  source: ${srcCount} rows · dest before: ${dstBefore} rows`);
  if (srcCount === 0) {
    console.log(`  nothing to copy`);
    return 0;
  }

  const colList = columns.join(", ");
  let inserted = 0;
  for (let offset = 0; offset < srcCount; offset += BATCH) {
    const rows = (await src.query(
      `SELECT ${colList} FROM ${table} ORDER BY ${columns[0]} LIMIT ${BATCH} OFFSET ${offset}`,
    )) as Record<string, unknown>[];
    if (rows.length === 0) break;

    // Build a parameterized INSERT with placeholders. JSON/array
    // columns come back from Neon as JS objects/arrays; the driver
    // passes them to Postgres as array literals by default, which
    // fails on json-typed columns. Stringify anything that isn't a
    // primitive so it round-trips as real JSON.
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const r of rows) {
      const placeholders: string[] = [];
      for (const c of columns) {
        const v = r[c];
        let out: unknown = v;
        if (v !== null && typeof v === "object" && !(v instanceof Date)) {
          // JSON/JSONB/array columns — serialize to a JSON string so
          // Postgres parses it as JSON rather than a Postgres array
          // literal.
          out = JSON.stringify(v);
        }
        values.push(out);
        placeholders.push(`$${values.length}`);
      }
      tuples.push(`(${placeholders.join(", ")})`);
    }
    const sql = `INSERT INTO ${table} (${colList}) VALUES ${tuples.join(", ")} ${conflictClause}`;
    await dest.query(sql, values);
    inserted += rows.length;
    process.stdout.write(`  copied ${inserted}/${srcCount}\r`);
  }
  const { dst: dstAfter } = await countOnBoth(table);
  console.log(`\n  dest after: ${dstAfter} rows  (+${dstAfter - dstBefore})`);
  return dstAfter - dstBefore;
}

async function main() {
  console.log("Copying v2-preview → production.\n");

  // geographies — production has 52 (v1 MSA set), v2-preview expanded
  // to ~199. Same UUIDs where both exist, so ON CONFLICT DO NOTHING
  // is safe. Must run before every FK-dependent table.
  await copyTable(
    "geographies",
    ["id", "cbsa_fips", "name", "short_name", "state", "lat", "lng", "population", "is_active", "created_at"],
    "ON CONFLICT (id) DO NOTHING",
  );

  await copyTable(
    "users",
    ["id", "email", "password_hash", "name", "email_verified_at", "last_login_at", "created_at", "updated_at"],
    `ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       password_hash = EXCLUDED.password_hash,
       name = EXCLUDED.name,
       email_verified_at = EXCLUDED.email_verified_at,
       last_login_at = EXCLUDED.last_login_at,
       updated_at = EXCLUDED.updated_at`,
  );

  await copyTable(
    "ops_builder_markets",
    ["id", "builder_ticker", "geography_id", "mention_count", "first_seen_year", "last_seen_year", "source_ids", "confidence", "updated_at"],
    "ON CONFLICT (id) DO NOTHING",
  );

  await copyTable(
    "zillow_zhvi",
    ["id", "geography_id", "period_date", "median_home_value", "source", "fetched_at"],
    "ON CONFLICT (id) DO NOTHING",
  );

  await copyTable(
    "fhfa_hpi",
    ["id", "geography_id", "year", "quarter", "hpi", "hpi_yoy_change_pct", "source", "fetched_at"],
    "ON CONFLICT (id) DO NOTHING",
  );

  await copyTable(
    "portfolio_health_snapshots",
    ["id", "geography_id", "snapshot_date", "financial_score", "demand_score", "operational_score", "composite_score", "inputs_json", "created_at"],
    "ON CONFLICT (id) DO NOTHING",
  );

  await copyTable(
    "market_opportunity_scores",
    ["id", "geography_id", "snapshot_date", "filter_1_migration", "filter_2_diversity", "filter_3_imbalance", "filter_4_competitive", "filter_5_affordability", "filter_6_operational", "num_green", "all_six_green", "inputs_json", "created_at"],
    "ON CONFLICT (id) DO NOTHING",
  );

  await copyTable(
    "market_narratives",
    ["id", "geography_id", "snapshot_date", "portfolio_health_blurb", "market_opportunity_blurb", "model", "generated_at"],
    "ON CONFLICT (id) DO NOTHING",
  );

  await copyTable(
    "tracked_markets",
    ["id", "org_id", "user_id", "geography_id", "added_at"],
    "ON CONFLICT (id) DO NOTHING",
  );

  await copyTable(
    "health_score_weights",
    ["user_id", "org_id", "weight_financial", "weight_demand", "weight_operational", "preset_name", "updated_at"],
    `ON CONFLICT (user_id, org_id) DO UPDATE SET
       weight_financial = EXCLUDED.weight_financial,
       weight_demand = EXCLUDED.weight_demand,
       weight_operational = EXCLUDED.weight_operational,
       preset_name = EXCLUDED.preset_name,
       updated_at = EXCLUDED.updated_at`,
  );

  await copyTable(
    "business_cases",
    ["id", "user_id", "org_id", "geography_id", "title", "notes", "inputs_json", "organic_outputs_json", "acquisition_outputs_json", "recommendation", "shared", "created_at", "updated_at"],
    "ON CONFLICT (id) DO NOTHING",
  );

  console.log("\n✓ Done.");
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
