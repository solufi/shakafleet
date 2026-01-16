import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const { email, password } = (await req.json()) as { email?: string; password?: string };

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Missing email or password" }, { status: 400 });
    }

    const adminEmail = requireEnv("ADMIN_EMAIL");
    const adminHash = requireEnv("ADMIN_PASSWORD_HASH");
    const authSecret = requireEnv("AUTH_SECRET");

    const emailOk = email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
    const passOk = await bcrypt.compare(password, adminHash);

    if (!emailOk || !passOk) {
      return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }

    // Minimal session cookie for MVP. Later: replace by iron-session or full auth + 2FA.
    // Cookie value is just a HMAC-like token derived from AUTH_SECRET (not reversible).
    const token = await bcrypt.hash(`${adminEmail}:${authSecret}`, 8);

    const jar = await cookies();
    jar.set("shaka_admin", token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Login error" },
      { status: 500 }
    );
  }
}
