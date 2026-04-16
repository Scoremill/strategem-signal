/**
 * Auth library — v2 multi-tenant.
 *
 * Issues and validates JWT session cookies that carry the user's identity
 * AND their currently active org context. Route handlers extract the
 * context via requireSession() and pass orgId to tenantQuery() from
 * src/lib/db/tenant.ts to enforce per-tenant data isolation.
 *
 * The cookie name is unchanged from v1 (`ss_session`) so middleware,
 * Vercel cron headers, and any other infrastructure that references the
 * cookie name keeps working. Only the payload shape changes.
 */
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "ss_session";
const SESSION_DURATION = 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET || "dev-secret";
  return new TextEncoder().encode(secret);
}

/**
 * The full session payload carried in the JWT.
 *
 * orgId / orgSlug / role describe the user's CURRENTLY ACTIVE org. A user
 * who belongs to multiple orgs has one membership at a time; switching
 * orgs re-issues the token with a different orgId/role.
 *
 * isSuperadmin is the env-var "first owner" backstop — it lets Drew log
 * in via ADMIN_EMAIL/ADMIN_PASSWORD even before any user row exists in
 * the DB. Once the bootstrap script creates Drew's user row, normal DB
 * login is preferred and isSuperadmin is no longer necessary, but the
 * backstop stays in place as a recovery path.
 */
export interface SessionPayload {
  userId: string;
  email: string;
  name: string | null;
  orgId: string;
  orgSlug: string;
  role: string;
  isSuperadmin?: boolean;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${SESSION_DURATION}s`)
    .setIssuedAt()
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (
      typeof payload.userId !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.orgId !== "string" ||
      typeof payload.orgSlug !== "string" ||
      typeof payload.role !== "string"
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      email: payload.email,
      name: (payload.name as string) ?? null,
      orgId: payload.orgId,
      orgSlug: payload.orgSlug,
      role: payload.role,
      isSuperadmin: payload.isSuperadmin === true,
    };
  } catch {
    return null;
  }
}

/**
 * Server-component / route-handler helper. Reads the cookie via the
 * Next.js cookies() API. Returns null if no session exists.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Edge / NextRequest helper. Used by middleware and any handler that
 * receives a NextRequest directly.
 */
export async function getSessionFromRequest(request: NextRequest): Promise<SessionPayload | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Throws a SessionError if the request has no valid session, otherwise
 * returns the parsed session. Use at the top of every authed route.
 *
 *   export async function GET(request: NextRequest) {
 *     const ctx = await requireSession(request);
 *     const t = tenantQuery(ctx.orgId);
 *     // ...
 *   }
 */
export async function requireSession(request: NextRequest): Promise<SessionPayload> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    throw new SessionError("Unauthorized", 401);
  }
  return session;
}

/**
 * Throws if the session's role isn't in the allowed list. Use AFTER
 * requireSession for endpoints that need role-gated access.
 *
 *   export async function DELETE(request: NextRequest) {
 *     const ctx = await requireSession(request);
 *     requireRole(ctx, ["owner"]); // only owner can delete the org
 *     // ...
 *   }
 *
 * The env-var superadmin always passes role checks — it's the recovery
 * path for when a normal owner gets locked out.
 */
export function requireRole(session: SessionPayload, allowedRoles: string[]) {
  if (session.isSuperadmin) return;
  if (!allowedRoles.includes(session.role)) {
    throw new SessionError(
      `Role '${session.role}' is not permitted. Required: ${allowedRoles.join(", ")}`,
      403
    );
  }
}

/**
 * Custom error so route handlers can convert it to a NextResponse with
 * the right status code.
 */
export class SessionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function setSessionCookie(token: string) {
  const c = await cookies();
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION,
  });
}

export async function clearSessionCookie() {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getSession()) !== null;
}

export function checkAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return password === expected;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_DURATION_SECONDS = SESSION_DURATION;
