/**
 * Login route — v2 multi-tenant.
 *
 * Two paths:
 *
 *   1. **Database login** (preferred): look up the user by email in the
 *      users table, verify the password hash with bcrypt, find their org
 *      memberships via org_memberships. If the user belongs to one org,
 *      issue the session for that org. If they belong to multiple, default
 *      to the first one alphabetically by org name (Phase 0.13 will add
 *      an org switcher UI; until then, multi-org users always start in
 *      one specific org and switch from inside the app).
 *
 *   2. **Superadmin backstop**: if the email matches ADMIN_EMAIL and the
 *      password matches ADMIN_PASSWORD, issue a session marked
 *      isSuperadmin = true. The superadmin still needs an org context, so
 *      we look up the same user row in the DB if it exists and use that
 *      org. If no DB user exists yet (very first run before bootstrap),
 *      we synthesize a placeholder org context so the user can at least
 *      log in and run the bootstrap script.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, orgMemberships, orgs } from "@/lib/db/schema";
import {
  checkAdminPassword,
  createSessionToken,
  verifyPassword,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
} from "@/lib/auth";
import { eq } from "drizzle-orm";

interface LoginRequestBody {
  email?: string;
  password?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginRequestBody;
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    // ─── Path 1: database user ──────────────────────────────────
    const [dbUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (dbUser) {
      const valid = await verifyPassword(password, dbUser.passwordHash);
      if (valid) {
        // Find the user's first org membership. join orgs to get the slug.
        const memberships = await db
          .select({
            orgId: orgMemberships.orgId,
            orgSlug: orgs.slug,
            orgName: orgs.name,
            role: orgMemberships.role,
          })
          .from(orgMemberships)
          .innerJoin(orgs, eq(orgMemberships.orgId, orgs.id))
          .where(eq(orgMemberships.userId, dbUser.id))
          .orderBy(orgs.name);

        if (memberships.length === 0) {
          // User exists but isn't in any org. They can't do anything.
          // Phase 0.13 invite flow handles this; for now, hard fail.
          return NextResponse.json(
            {
              error:
                "Your account exists but is not yet attached to any organization. " +
                "Contact your org owner for an invite.",
            },
            { status: 403 }
          );
        }

        // Pick the first org (alphabetical). Phase 0.13 adds switching UI.
        const active = memberships[0];

        const token = await createSessionToken({
          userId: dbUser.id,
          email: dbUser.email,
          name: dbUser.name ?? null,
          orgId: active.orgId,
          orgSlug: active.orgSlug,
          role: active.role,
        });

        // Update last_login_at timestamp (fire and forget; don't block login on it)
        db
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, dbUser.id))
          .catch((err) => console.warn("[login] last_login_at update failed:", err));

        const response = NextResponse.json({
          ok: true,
          email: dbUser.email,
          orgSlug: active.orgSlug,
          orgName: active.orgName,
          role: active.role,
        });
        response.cookies.set(SESSION_COOKIE_NAME, token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: SESSION_DURATION_SECONDS,
        });
        return response;
      }
      // Invalid password for an existing DB user — fall through to the env-var
      // check ONLY if the email also matches ADMIN_EMAIL. This means a leaked
      // password on the DB user can't be bypassed via a different env-var
      // password unless it's the same email.
    }

    // ─── Path 2: superadmin env-var backstop ────────────────────
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (email === adminEmail && checkAdminPassword(password)) {
      // If a DB user exists for this email, use its org context. Otherwise
      // synthesize a placeholder so the very-first-login user can run the
      // bootstrap script.
      let orgId = "_pre_bootstrap";
      let orgSlug = "_pre_bootstrap";
      let role = "owner";
      let userId = dbUser?.id ?? "_superadmin";

      if (dbUser) {
        const [firstMembership] = await db
          .select({
            orgId: orgMemberships.orgId,
            orgSlug: orgs.slug,
            role: orgMemberships.role,
          })
          .from(orgMemberships)
          .innerJoin(orgs, eq(orgMemberships.orgId, orgs.id))
          .where(eq(orgMemberships.userId, dbUser.id))
          .orderBy(orgs.name)
          .limit(1);

        if (firstMembership) {
          orgId = firstMembership.orgId;
          orgSlug = firstMembership.orgSlug;
          role = firstMembership.role;
        }
        userId = dbUser.id;
      }

      const token = await createSessionToken({
        userId,
        email,
        name: dbUser?.name ?? "Superadmin",
        orgId,
        orgSlug,
        role,
        isSuperadmin: true,
      });

      const response = NextResponse.json({
        ok: true,
        email,
        orgSlug,
        role,
        isSuperadmin: true,
      });
      response.cookies.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_DURATION_SECONDS,
      });
      return response;
    }

    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  } catch (err) {
    console.error("[login] error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
