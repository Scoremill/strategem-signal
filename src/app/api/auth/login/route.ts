import { NextResponse } from "next/server";
import {
  checkAdminPassword,
  createSessionToken,
  setSessionCookie,
} from "@/lib/auth";

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
      await setSessionCookie(token);
      return NextResponse.json({ ok: true, role: "superadmin" });
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
