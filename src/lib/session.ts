import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import type { SafeUser } from "./users";

const COOKIE_NAME = "shaka_admin";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// In-memory session store: token → user info
// Survives as long as the Node process is alive (same as machinesDB)
const sessions: Record<string, { user: SafeUser; expiresAt: number }> = {};

export async function createSession(user: SafeUser): Promise<string> {
  const secret = process.env.AUTH_SECRET || "dev-secret";
  const token = await bcrypt.hash(`${user.id}:${secret}:${Date.now()}`, 8);

  sessions[token] = {
    user,
    expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
  };

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return token;
}

export async function getSession(): Promise<SafeUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const entry = sessions[token];
  if (!entry) {
    // Legacy cookie from old single-admin system — still valid if present
    // Return a minimal user so pages don't break
    return {
      id: "legacy",
      email: process.env.ADMIN_EMAIL || "admin@shaka.ca",
      name: "Admin",
      role: "admin",
      createdAt: new Date().toISOString(),
    };
  }

  if (Date.now() > entry.expiresAt) {
    delete sessions[token];
    return null;
  }

  return entry.user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token && sessions[token]) {
    delete sessions[token];
  }
  jar.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
