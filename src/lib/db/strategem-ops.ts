/**
 * StrategemOps read-only Postgres client.
 *
 * SCOPE: Used ONLY by the monthly snapshot job at /api/cron/ops-snapshot.
 * No user-facing route or component should import this — they should query
 * the local ops_* mirror tables in StrategemSignal's own DB instead. The
 * snapshot job is the single bridge between the two databases.
 *
 * AUTH: Connects as the strategem_signal_reader Postgres role created in
 * StrategemOps (project curly-mud-45701913). That role has SELECT on 14
 * whitelisted tables and nothing else; it cannot write or read auth tables
 * under any circumstance. See PLAN.md "v2 Rebuild" section for the full list.
 *
 * FAILURE MODE: If STRATEGEM_OPS_DB_URL is unset (e.g. local dev without the
 * env var), getOpsClient() throws a clear error. The snapshot job catches
 * this and writes a 'failed' row to ops_snapshot_log so the daily self-heal
 * cron retries the next day.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let cached: NeonQueryFunction<false, false> | null = null;

export function getOpsClient(): NeonQueryFunction<false, false> {
  if (cached) return cached;
  const url = process.env.STRATEGEM_OPS_DB_URL;
  if (!url) {
    throw new Error(
      "STRATEGEM_OPS_DB_URL is not set. The ops snapshot job needs the read-only " +
        "connection string for the strategem_signal_reader role on StrategemOps."
    );
  }
  cached = neon(url);
  return cached;
}
