import { NextResponse } from "next/server";
import { findUserByEmail, verifyPassword, recordLogin, toSafe } from "../../../../lib/users";
import { createSession } from "../../../../lib/session";

export async function POST(req: Request) {
  try {
    const { email, password } = (await req.json()) as { email?: string; password?: string };

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Email et mot de passe requis" }, { status: 400 });
    }

    const user = findUserByEmail(email);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Identifiants invalides" }, { status: 401 });
    }

    const valid = await verifyPassword(user, password);
    if (!valid) {
      return NextResponse.json({ ok: false, error: "Identifiants invalides" }, { status: 401 });
    }

    recordLogin(user.id);
    const safeUser = toSafe(user);
    await createSession(safeUser);

    return NextResponse.json({ ok: true, user: safeUser });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur de connexion" },
      { status: 500 }
    );
  }
}
