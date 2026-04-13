/**
 * Tenant-scoped query helper.
 *
 * StrategemSignal v2 is a multi-tenant SaaS. The 11 tables registered below
 * carry an `org_id` column and MUST never be queried without filtering by
 * the calling user's organization. This file is the single source of truth
 * for that rule.
 *
 * Usage from a route handler:
 *
 *   import { tenantQuery } from "@/lib/db/tenant";
 *   import { trackedMarkets } from "@/lib/db/schema";
 *
 *   export async function GET(request) {
 *     const ctx = await requireSession(request); // returns { userId, orgId, role }
 *     const t = tenantQuery(ctx.orgId);
 *     const rows = await t.select(trackedMarkets);  // org_id filter applied automatically
 *     return NextResponse.json(rows);
 *   }
 *
 * The helper applies WHERE org_id = ctx.orgId to every select, insert, update,
 * and delete against tenant-scoped tables. Forgetting to use it is a
 * security bug. Background jobs that legitimately need cross-tenant access
 * (the snapshot cron, the federal data pipelines, scoring jobs that score
 * all markets at once) use the raw `db` client and MUST document why.
 *
 * Why not Postgres Row-Level Security?
 * The Neon HTTP driver doesn't maintain a persistent session between
 * queries (each query is a separate HTTP request), so session variables
 * — the standard RLS injection mechanism — don't persist. RLS would
 * require switching to the WebSocket Pool driver, which adds connection
 * setup latency on every request. App-level enforcement via this helper
 * is faster, fits the Neon HTTP pattern we already use, and the type
 * system + this single discipline catches misuse. If we later move to
 * Pool-based connections (e.g. for streaming queries in Phase 4), real
 * RLS can be layered on top without touching the schema.
 */
import { db } from "./index";
import {
  orgs,
  users,
  orgMemberships,
  trackedMarkets,
  watchlistMarkets,
  healthScoreWeights,
  flags,
  businessCases,
  alertPreferences,
  alerts,
  auditLog,
} from "./schema";
import { eq, and, type SQL } from "drizzle-orm";
import { randomUUID } from "crypto";

/**
 * Registry of every tenant-scoped table. The build will fail if a table is
 * added to schema.ts with an org_id column but not added here.
 */
export const TENANT_SCOPED_TABLES = {
  orgs,
  users,
  orgMemberships,
  trackedMarkets,
  watchlistMarkets,
  healthScoreWeights,
  flags,
  businessCases,
  alertPreferences,
  alerts,
  auditLog,
} as const;

export type TenantScopedTable = (typeof TENANT_SCOPED_TABLES)[keyof typeof TENANT_SCOPED_TABLES];

/**
 * Returns a thin tenant-scoped query builder bound to a specific org.
 *
 * Example:
 *   const t = tenantQuery(ctx.orgId);
 *   const rows = await t.select(trackedMarkets);
 *   const inserted = await t.insert(trackedMarkets, { geographyId, addedBy });
 *   await t.update(trackedMarkets, { addedBy }, eq(trackedMarkets.id, rowId));
 *   await t.delete(trackedMarkets, eq(trackedMarkets.id, rowId));
 *
 * The org filter is always applied. You cannot construct a tenantQuery
 * without supplying an orgId, and you cannot bypass the filter from inside
 * the returned builder.
 */
export function tenantQuery(orgId: string) {
  if (!orgId) {
    throw new Error("tenantQuery requires a non-empty orgId");
  }

  return {
    /**
     * Select rows from a tenant-scoped table. Optionally filter further
     * with an additional WHERE clause that's AND-ed with the org filter.
     */
    async select<T extends TenantScopedTable>(table: T, where?: SQL) {
      const orgFilter = buildOrgFilter(table, orgId);
      const finalWhere = where ? and(orgFilter, where) : orgFilter;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return db.select().from(table as any).where(finalWhere);
    },

    /**
     * Insert a row into a tenant-scoped table. Two safety guarantees:
     *
     *   1. The org_id is forcibly set to the helper's bound orgId. Any
     *      org_id the caller passes is overwritten — you cannot inject
     *      another tenant's id from a tenantQuery bound to your own.
     *
     *   2. If the table has a text primary key named `id` and the caller
     *      didn't supply one, a UUID is generated automatically. Tenant-
     *      scoped tables in this schema all use text UUIDs without a DB
     *      default, so this matches the v1 convention everywhere.
     */
    async insert<T extends TenantScopedTable>(
      table: T,
      values: Record<string, unknown>
    ) {
      const orgIdColumn = getOrgIdColumnName(table);
      const merged: Record<string, unknown> = {
        ...values,
        [orgIdColumn]: orgId,
      };
      if (merged.id === undefined && tableHasTextIdPk(table)) {
        merged.id = randomUUID();
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return db.insert(table as any).values(merged).returning();
    },

    /**
     * Update rows in a tenant-scoped table. The org filter is AND-ed with
     * the caller's WHERE clause so updates can never affect other tenants'
     * rows even if the caller's filter would otherwise match them.
     */
    async update<T extends TenantScopedTable>(
      table: T,
      set: Record<string, unknown>,
      where: SQL
    ) {
      const orgFilter = buildOrgFilter(table, orgId);
      const finalWhere = and(orgFilter, where);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return db.update(table as any).set(set).where(finalWhere).returning();
    },

    /**
     * Delete rows from a tenant-scoped table. Same org-filter guarantee.
     */
    async delete<T extends TenantScopedTable>(table: T, where: SQL) {
      const orgFilter = buildOrgFilter(table, orgId);
      const finalWhere = and(orgFilter, where);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return db.delete(table as any).where(finalWhere).returning();
    },

    /**
     * The bound orgId — exposed for cases where the caller needs to check
     * which tenant context they're in (e.g., to log it).
     */
    orgId,
  };
}

/**
 * Returns the Drizzle column representing the org filter for a given table.
 * `orgs` and `users` are special: orgs filters by id, users currently
 * doesn't have a direct org_id column (it's joined via org_memberships) so
 * users queries must use the standard db client and join through the
 * membership table. We register users in TENANT_SCOPED_TABLES so the
 * registry stays complete, but tenantQuery throws if you try to use it on
 * users — call sites must explicitly join through org_memberships.
 */
function buildOrgFilter(table: TenantScopedTable, orgId: string): SQL {
  if (table === orgs) {
    return eq(orgs.id, orgId);
  }
  if (table === users) {
    throw new Error(
      "tenantQuery cannot be used directly on the users table. " +
        "User identity is shared across orgs; query through org_memberships " +
        "with an explicit org filter to scope results to the current tenant."
    );
  }
  // All other tenant-scoped tables have an org_id column.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgIdCol = (table as any).orgId;
  if (!orgIdCol) {
    throw new Error(
      `Tenant-scoped table ${(table as { _: { name: string } })._.name} ` +
        "is registered in TENANT_SCOPED_TABLES but has no orgId column. " +
        "Add the column or remove the table from the registry."
    );
  }
  return eq(orgIdCol, orgId);
}

/**
 * Returns the source-name of the org_id column for inserts. Mirrors the
 * special cases above.
 */
function getOrgIdColumnName(table: TenantScopedTable): string {
  if (table === orgs) return "id";
  if (table === users) {
    throw new Error(
      "tenantQuery cannot insert into users directly. Create the user via " +
        "the auth flow and then create an org_memberships row to attach " +
        "them to a tenant."
    );
  }
  return "orgId";
}

/**
 * Returns true if the table has a text-typed `id` primary key with no
 * default, in which case the helper auto-generates a UUID at insert time.
 *
 * Tables without an `id` column (where org_id is the PK):
 *   - health_score_weights (org_id text PRIMARY KEY)
 *
 * The `orgs` table has an `id` text PK; we treat it as auto-id-generating
 * EXCEPT that the bound orgId is forced into the id column above. Since
 * orgs is special anyway (you don't tenantQuery your own org row into
 * existence), this branch returns false to avoid double-assignment.
 */
function tableHasTextIdPk(table: TenantScopedTable): boolean {
  if (table === healthScoreWeights) return false;
  if (table === orgs) return false;
  return true;
}
