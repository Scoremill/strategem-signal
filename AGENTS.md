<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Multi-tenant data access (v2)

StrategemSignal v2 is a multi-tenant SaaS. Every database table that holds
**per-organization data** carries an `org_id` column and MUST be queried
through the tenant helper at `src/lib/db/tenant.ts`.

## The rule

Any query against a table registered in `TENANT_SCOPED_TABLES` MUST go
through `tenantQuery(orgId)`. Direct use of the `db` client on those
tables is a security bug.

```ts
// ✅ correct
import { tenantQuery } from "@/lib/db";
import { trackedMarkets } from "@/lib/db/schema";

const t = tenantQuery(ctx.orgId);
const rows = await t.select(trackedMarkets);

// ❌ wrong — no tenant filter, will leak rows from every org
import { db } from "@/lib/db";
const rows = await db.select().from(trackedMarkets);
```

## Tables this rule applies to

`orgs`, `users`, `org_memberships`, `tracked_markets`, `watchlist_markets`,
`health_score_weights`, `flags`, `business_cases`, `alert_preferences`,
`alerts`, `audit_log`. The full list is exported as `TENANT_SCOPED_TABLES`
from `src/lib/db/tenant.ts` — if you add a new tenant-scoped table to
`schema.ts`, add it to that registry in the same commit.

## When you can use the raw `db` client

Background jobs that legitimately need cross-tenant access:
- `src/lib/pipelines/ops-snapshot-pipeline.ts` — writes to `ops_*` mirror
  tables which are shared across all tenants
- The federal data pipelines (`demand`, `capacity`, `oes`, `income`) —
  write to global reference tables (`permit_data`, `employment_data`,
  etc.) that are not tenant-scoped
- Phase 2 scoring jobs that compute filter scores for all 380 MSAs at
  once — write to `market_opportunity_scores` which is not tenant-scoped

If you use raw `db` on a tenant-scoped table, **leave a code comment
explaining why** so the next reviewer knows it was intentional.

## Special case: the `users` table

`users` holds identity, not org membership. A user can belong to multiple
orgs. `tenantQuery(orgId).select(users)` throws — query through
`org_memberships` with an explicit join when you need the users belonging
to a specific tenant.

## Why not Postgres Row-Level Security?

The Neon HTTP driver doesn't maintain a persistent session between
queries (each query is a separate HTTP request), so session variables —
the standard RLS injection mechanism — don't persist. Switching to the
WebSocket Pool driver would add connection setup latency on every
request. App-level enforcement via `tenantQuery` is faster, fits the
Neon HTTP pattern we already use, and the type system catches misuse on
inserts (you literally cannot construct a `tenantQuery` without an
`orgId`). If we later move to Pool-based connections (e.g. for streaming
in Phase 4), real RLS can be layered on top without touching the schema.
