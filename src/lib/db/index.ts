import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// The Neon client is initialized lazily on first use rather than at module
// load. Next.js's "collect page data" build step imports every route module
// once before any request is served; if `neon()` is called at the top level
// and DATABASE_URL is missing in that environment, the entire build crashes
// with "No database connection string was provided to neon()". Lazy init
// lets the module load cleanly even when the env var isn't present at
// build-time, while still throwing a clear error the moment any actual
// query is attempted.
let _client: NeonQueryFunction<false, false> | null = null;
let _db: NeonHttpDatabase<typeof schema> | null = null;

function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The Neon client cannot be initialized."
    );
  }
  _client = neon(url);
  _db = drizzle(_client, { schema });
  return _db;
}

// Expose `db` as a Proxy so callers keep the existing `db.select()` /
// `db.insert()` / `db.execute()` API. The first method access triggers
// lazy initialization.
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };

// v2 multi-tenant helper. App routes that touch tenant-scoped tables MUST
// use tenantQuery(orgId) instead of `db` directly. Background jobs that
// legitimately need cross-tenant access use `db` and document why.
export { tenantQuery, TENANT_SCOPED_TABLES } from "./tenant";
export type { TenantScopedTable } from "./tenant";
