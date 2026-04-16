/**
 * Audit log helper.
 *
 * One writer for every meaningful user action across the app. CEO
 * requirement 6.4 — board-defensibility means we can point at an
 * immutable log of "who changed what, when" for every settings
 * change, every flag, every business case, every watchlist edit.
 *
 * Usage (server-only, inside a server action or API route):
 *
 *   import { recordAudit } from "@/lib/audit";
 *   await recordAudit({
 *     orgId: session.orgId,
 *     userId: session.userId,
 *     action: "business_case.saved",
 *     entityType: "business_case",
 *     entityId: row.id,
 *     after: { title, geographyId, recommendation },
 *   });
 *
 * Design notes:
 *
 * - Fire-and-forget semantics. The helper catches any error and
 *   logs it — we never want an audit failure to break the primary
 *   action the user took. The log is important but not critical to
 *   the happy path.
 * - before/after JSON is optional. For create actions, just set
 *   `after`. For deletes, set `before`. For updates, set both so
 *   the diff is reconstructable.
 * - The audit_log table schema already exists (Phase 0.7). No
 *   migration needed.
 * - Conventionally, action strings use dotted namespace + past
 *   tense: "tracked_market.added", "weights.updated",
 *   "business_case.saved", etc. This makes filtering easy.
 */
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { randomUUID } from "crypto";

export interface AuditEntry {
  orgId: string;
  userId: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: randomUUID(),
      orgId: entry.orgId,
      userId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      beforeJson: entry.before ?? null,
      afterJson: entry.after ?? null,
    });
  } catch (err) {
    // Never let an audit failure break the primary action. Log
    // prominently so we notice in production.
    console.error("[audit] failed to record entry", entry, err);
  }
}
