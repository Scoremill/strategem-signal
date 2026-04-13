import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });

export { schema };

// v2 multi-tenant helper. App routes that touch tenant-scoped tables MUST
// use tenantQuery(orgId) instead of `db` directly. Background jobs that
// legitimately need cross-tenant access use `db` and document why.
export { tenantQuery, TENANT_SCOPED_TABLES } from "./tenant";
export type { TenantScopedTable } from "./tenant";
