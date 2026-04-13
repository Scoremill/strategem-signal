# StrategemSignal — CEO Strategic Market Intelligence Platform (v2)

## What this is

A multi-tenant SaaS for homebuilder CEOs that answers six independent
strategic questions about every U.S. metro market: migration tailwinds,
employment diversity, supply-demand imbalance, competitive landscape,
affordability runway, and operational feasibility. Each filter scores
0-100 with full source traceability — every claim links back to its
underlying federal or competitor data.

The product is being rebuilt from scratch on the `v2` branch. Production
`main` is the v1 demand-capacity-ratio app and stays deployed until v2
ships. Read [PLAN.md](../PLAN.md) for the phased build plan.

## Tech stack

- **Framework:** Next.js 16 (App Router) + Tailwind CSS + Recharts
- **Database:** Drizzle ORM + Neon serverless Postgres (HTTP driver)
- **Map:** Mapbox GL JS (Phase 1 reuses v1 setup)
- **Auth:** bcryptjs + JWT via jose, multi-tenant from day one
- **Hosting:** Vercel (Hobby plan — 300s function cap matters)
- **Source control:** GitHub (Scoremill/strategem-signal)
- **Scheduling:** GitHub Actions cron (NEVER Vercel Cron — Drew's standing rule)
- **Email:** Gmail + Nodemailer (NEVER Resend — Strategem global standard)
- **Billing:** Stripe (deferred to launch — see Phase 0.12 in PLAN.md)

## Multi-tenant data access

**Every database query against a tenant-scoped table MUST go through
`tenantQuery(orgId)` from `src/lib/db/tenant.ts`.** The full rule and
table list is in [AGENTS.md](./AGENTS.md). Direct use of the `db` client
on those tables is a security bug.

```ts
import { tenantQuery } from "@/lib/db";
import { trackedMarkets } from "@/lib/db/schema";

const t = tenantQuery(ctx.orgId);
const rows = await t.select(trackedMarkets);  // org_id filter applied
```

11 tenant-scoped tables: `orgs`, `users`, `org_memberships`,
`tracked_markets`, `watchlist_markets`, `health_score_weights`, `flags`,
`business_cases`, `alert_preferences`, `alerts`, `audit_log`.

## Auth model

- **Single auth system, multi-tenant aware.** JWT carries
  `{ userId, email, name, orgId, orgSlug, role, isSuperadmin? }`.
- **Login flow:** DB user lookup → bcrypt verify → resolve org
  membership → issue JWT for the user's first org alphabetically.
  Multi-org users will get an org switcher in Phase 0.13+.
- **Superadmin backstop:** `ADMIN_EMAIL` + `ADMIN_PASSWORD` env vars
  let Drew log in even if the DB user row is missing or broken. The
  resulting session is marked `isSuperadmin: true` and bypasses role
  checks. This is the recovery path; use the DB flow normally.
- **Session cookie:** `ss_session` (HttpOnly, 7-day expiry) — name
  unchanged from v1.
- **Helpers:** `requireSession(request)` and `requireRole(ctx, [...])`
  in `src/lib/auth.ts`.
- **Middleware** (`src/middleware.ts`) protects every route except
  `/sign-in`, `/api/auth/*`, `/api/cron/*`, and `/api/ops-snapshot-status`.

## Two databases

1. **StrategemSignal Neon** (`fancy-mountain-71820151`) — the v2 app's
   own database. Holds federal data (permits, employment, etc.), the
   multi-tenant tables (orgs/users/etc.), and 15 `ops_*` mirror tables
   that hold local snapshots of StrategemOps data.

2. **StrategemOps Neon** (`curly-mud-45701913`) — the sister project's
   database. Owned by the StrategemOps app. We have a read-only
   Postgres role `strategem_signal_reader` with `SELECT` on 14
   whitelisted tables. The monthly snapshot job is the **single**
   bridge between the two databases — no user-facing route ever
   queries StrategemOps directly.

The reader role's connection string lives in `STRATEGEM_OPS_DB_URL`.
The provenance comment in `.env.local` documents which email is
attached to the role.

## Data pipeline architecture

**Federal data pipelines** (all run on GitHub Actions cron schedules):
- `/api/cron/demand` — Census Building Permits, FRED employment + UR + population
- `/api/cron/capacity` — BLS QCEW (quarterly trade employment + wages)
- `/api/cron/oes` — BLS OEWS (annual occupation-level wages, SOC 47-xxxx)
- `/api/cron/income` — Census ACS B19013 median household income (annual)

**Cross-database snapshot:**
- `/api/cron/ops-snapshot` — pulls 14 StrategemOps tables into local
  `ops_*` mirrors. Runs monthly (1st of each month, 6 AM CT) via
  `.github/workflows/ops-snapshot.yml`. A daily self-heal workflow
  (`ops-snapshot-retry.yml`) checks the snapshot status and only fires
  the snapshot endpoint if the most recent run failed or is older than
  35 days. Healthy days exit silently with zero StrategemOps queries.

**One-shot scripts** (`scripts/`):
- `bootstrap-first-org.ts` — creates the first user + org + owner
  membership from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Idempotent.
- `run-ops-snapshot.ts` — manual trigger for the snapshot pipeline.
- `test-tenant-isolation.ts` — six-check smoke test that proves
  `tenantQuery` correctly isolates orgs end-to-end.

## What you cannot do on Vercel Hobby

The 300-second serverless function timeout is a hard ceiling. Any
pipeline that writes more than ~250 rows in a single invocation must
use bulk inserts. The `ops-snapshot-pipeline.ts` uses 500-row
parameterized batches — without that pattern the snapshot took 13
minutes; with bulk it's 30 seconds.

If you write a new pipeline that touches mirror or scoring tables,
**estimate row volume × write latency before writing the loop**.
Per-row HTTP round-trips on Neon serverless are ~100ms each; 250 rows
= 25 seconds; 1,000 rows = 100 seconds; 3,000 rows = 5 minutes.

## Neon projects

- StrategemSignal: `fancy-mountain-71820151` (this app, default DB)
- StrategemOps: `curly-mud-45701913` (sister app, read-only mirror source)

## Debugging standard

**Never guess at issues.** When Drew reports a bug or problem, reproduce
and diagnose it with real testing (curl, logs, database queries) BEFORE
attempting a fix. Do not hypothesize causes and push speculative fixes.
Test on production, read the actual error, trace the actual data flow.
Three failed guesses wastes more time than one proper investigation.

## v1 → v2 transition state

While the rebuild is in progress:
- `main` branch: v1 (composite Demand-Capacity Ratio app, deployed to production)
- `v2` branch: v2 rebuild (CEO platform, six-filter scoring, multi-tenant)

Phase 0 of v2 (the foundation) lands the multi-tenant infrastructure,
the StrategemOps bridge, and a wiped slate ready for Phase 1.

If you're working on the v1 product (bug fixes, urgent customer issues),
work on `main`. If you're building the new product, work on `v2`. Don't
mix them.
