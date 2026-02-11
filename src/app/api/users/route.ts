import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { listUsers, createUser, updateUser, deleteUser, type UserRole } from "../../../lib/users";

// GET /api/users – list all users (admin only)
export async function GET() {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  return NextResponse.json({ ok: true, users: listUsers() });
}

// POST /api/users – create a new user (admin only)
export async function POST(req: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  try {
    const { email, password, name, role } = (await req.json()) as {
      email?: string;
      password?: string;
      name?: string;
      role?: UserRole;
    };

    if (!email || !password || !name) {
      return NextResponse.json({ ok: false, error: "Email, mot de passe et nom requis" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ ok: false, error: "Le mot de passe doit contenir au moins 6 caractères" }, { status: 400 });
    }

    const user = await createUser(email, password, name, role);
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}

// PATCH /api/users – update a user (admin only)
export async function PATCH(req: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  try {
    const { id, name, role, password } = (await req.json()) as {
      id?: string;
      name?: string;
      role?: UserRole;
      password?: string;
    };

    if (!id) {
      return NextResponse.json({ ok: false, error: "ID utilisateur requis" }, { status: 400 });
    }

    if (password && password.length < 6) {
      return NextResponse.json({ ok: false, error: "Le mot de passe doit contenir au moins 6 caractères" }, { status: 400 });
    }

    const user = await updateUser(id, { name, role, password });
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}

// DELETE /api/users?id=xxx – delete a user (admin only)
export async function DELETE(req: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "ID utilisateur requis" }, { status: 400 });
  }

  // Prevent self-deletion
  if (id === me.id) {
    return NextResponse.json({ ok: false, error: "Vous ne pouvez pas supprimer votre propre compte" }, { status: 400 });
  }

  try {
    deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}
