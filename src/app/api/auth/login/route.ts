import { NextResponse } from "next/server";
import { checkAdminPassword, createSessionToken } from "@/lib/auth";

const COOKIE_NAME = "ss_session";
const SESSION_DURATION = 60 * 60 * 24 * 7; // 7 days

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }

    // Check admin credentials (env-var based)
    const adminEmail = process.env.ADMIN_EMAIL;
    if (email === adminEmail && checkAdminPassword(password)) {
      const token = await createSessionToken({
        email,
        role: "superadmin",
      });

      const response = NextResponse.json({ ok: true, role: "superadmin" });
      response.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_DURATION,
      });
      return response;
    }

    // TODO: check DB users for regular login
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 }
    );
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
