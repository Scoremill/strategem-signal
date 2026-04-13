import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "ss_session";
const PUBLIC_PATHS = [
  "/sign-in",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/cron/",
  // Snapshot status endpoint is read-only and exposes only timestamps + a
  // boolean. The daily self-heal GitHub Actions workflow polls it without
  // a session cookie to decide whether the StrategemOps snapshot needs a
  // retry. Keeping it public lets the workflow stay simple.
  "/api/ops-snapshot-status",
];

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET || "dev-secret";
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Check session
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    // API routes get 401 JSON, pages get redirected
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  try {
    await jwtVerify(token, getSecret());
    return NextResponse.next();
  } catch {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
