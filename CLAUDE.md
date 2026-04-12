# StrategemSignal — Demand-Capacity Market Intelligence Platform

## Tech Stack
- Next.js 16 (App Router) + Tailwind CSS + Recharts
- Drizzle ORM + Neon serverless Postgres (PostGIS enabled)
- Mapbox GL JS for choropleth heatmaps
- Data sources: BLS (QCEW, CES, OES, JOLTS), Census (Permits, ACS, CBP, C30, Population Estimates), IRS SOI
- Deployed on Vercel, source on GitHub (Scoremill/strategem-signal)
- Scheduling: GitHub Actions cron (NOT Vercel Cron)
- Email: Gmail + Nodemailer (NOT Resend)

## What This Is
A two-sided market intelligence platform for homebuilders that combines demand signals (permits, employment, migration, income) with trade labor capacity signals (QCEW employment, wages, establishment counts, permits-per-worker) into a Demand-Capacity Ratio per MSA. The ratio classifies markets as favorable (<0.85, green), equilibrium (0.85-1.15, yellow), or constrained (>1.15, red).

## Core Metric
The Demand-Capacity Ratio is the central analytical output. It divides a blended Demand Index by a blended Capacity Index. Key insight: demand without capacity is a mirage — strong permits in a labor-constrained market means cycle time blowouts and margin compression, not profitable closings.

## Auth Model
- Single auth system: admin (env var credentials) and users (DB + bcryptjs + JWT via jose)
- Session cookie: `ss_session` (HttpOnly, 7-day expiry)
- Middleware protects all routes except `/sign-in` and auth API endpoints

## Data Pipeline Architecture
- All data sources are free federal APIs/CSVs (BLS, Census)
- Demand pipelines: monthly (permits, employment) and annual (migration, income)
- Capacity pipelines: quarterly (QCEW) and annual (OES, CBP)
- GitHub Actions cron triggers API endpoints for each pipeline
- Scoring engine recalculates indices and ratio after each data ingestion

## MVP Scope
- 15 MSA markets (Sun Belt growth corridor + key builder markets)
- Demand Index: Permits 30%, Employment 25%, Migration 20%, Income 15%, Starts 10%
- Capacity Index: Trade Employment 25%, Wage Acceleration (inverse) 25%, Permits-per-Worker (inverse) 20%, Establishments 15%, Dollars-per-Worker (inverse) 15%

## Neon Project
- Project ID: fancy-mountain-71820151
- Database: neondb

## Debugging Standard

**Never guess at issues.** When Drew reports a bug or problem, reproduce and diagnose it with real testing (curl, logs, database queries) BEFORE attempting a fix. Do not hypothesize causes and push speculative fixes. Test on production, read the actual error, trace the actual data flow. Three failed guesses wastes more time than one proper investigation.
