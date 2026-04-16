# v2 → main Merge Checklist

Run through this before hitting `git merge v2` into main. Every item
has a way to verify independently of me.

## 1. Neon — create the five missing tables on production

```bash
# Copy-paste from scripts/v2-production-migrations.sql
# Run against the main (default) branch of
# Neon project fancy-mountain-71820151.
```

Five tables: `zillow_zhvi`, `fhfa_hpi`, `portfolio_health_snapshots`,
`market_opportunity_scores`, `market_narratives`. All statements are
idempotent so re-running is safe.

After running, verify with:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name IN (
  'zillow_zhvi','fhfa_hpi','portfolio_health_snapshots',
  'market_opportunity_scores','market_narratives'
);
```
Should return five rows.

## 2. Vercel — verify production env vars

Required on Production environment:

| Variable | Criticality | Notes |
|---|---|---|
| `DATABASE_URL` | **Critical** | Must point at main branch, not v2-preview |
| `STRATEGEM_OPS_DB_URL` | **Critical** | Read-only reader role in StrategemOps Neon |
| `ADMIN_SESSION_SECRET` | **Critical** | Without this, JWT falls back to "dev-secret" and nobody can log in |
| `ADMIN_EMAIL` | Critical | Superadmin recovery |
| `ADMIN_PASSWORD` | Critical | Superadmin recovery |
| `OPENAI_API_KEY` | High | Narrative cron |
| `BLS_API_KEY` | High | Capacity + OES crons |
| `FRED_API_KEY` | High | Demand cron |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | High | Heatmap |
| `CRON_SECRET` | High | Auth for cron endpoints |
| `GMAIL_USER` | Medium | Email fallback (Phase 4.3) |
| `GMAIL_APP_PASSWORD` | Medium | Email fallback |
| `DIGEST_RECIPIENTS` | Low | Weekly digest (Phase 4.4) |

## 3. Merge + push

```bash
git checkout main
git pull origin main
git merge v2 --no-ff -m "Merge v2: CEO platform GA"
git push origin main
```

## 4. Post-merge verification (first 10 minutes)

- Vercel build succeeded (check dashboard)
- `/sign-in` loads (HTTP 200, no 500)
- Sign in as admin, get to `/heatmap`
- `/heatmap` renders (even if dots are gray pending first cron run)
- Trigger `portfolio-health` cron manually from GitHub Actions
- Verify one row landed in `portfolio_health_snapshots` on production

## Rollback

If production breaks badly:

```bash
git checkout main
git revert -m 1 HEAD  # revert the merge
git push origin main
```

Vercel will redeploy the pre-merge state in ~3 minutes.

The five new tables stay in place (empty, harmless). No data loss.
