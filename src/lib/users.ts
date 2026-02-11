import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

export type UserRole = "admin" | "viewer";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  lastLogin?: string;
}

export type SafeUser = Omit<User, "passwordHash">;

// ---------------------------------------------------------------------------
// Storage – JSON file persisted on disk
// In Docker: mount a volume to /app/data so it survives container restarts
// Dev: uses ./data/users.json relative to project root
// ---------------------------------------------------------------------------
const DATA_DIR = process.env.USERS_DATA_DIR || path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readUsers(): User[] {
  ensureDir();
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(raw) as User[];
  } catch {
    return [];
  }
}

function writeUsers(users: User[]) {
  ensureDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Bootstrap – create default admin from env vars on first run
// ---------------------------------------------------------------------------
function bootstrap(): User[] {
  let users = readUsers();
  if (users.length > 0) return users;

  const email = process.env.ADMIN_EMAIL;
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!email || !hash) return users;

  const admin: User = {
    id: crypto.randomUUID(),
    email: email.trim().toLowerCase(),
    name: "Admin",
    passwordHash: hash,
    role: "admin",
    createdAt: new Date().toISOString(),
  };
  users = [admin];
  writeUsers(users);
  console.log(`[users] Bootstrapped default admin: ${admin.email}`);
  return users;
}

// In-memory cache (refreshed from disk on mutations)
let _cache: User[] | null = null;

function getUsers(): User[] {
  if (!_cache) _cache = bootstrap();
  return _cache;
}

function persist(users: User[]) {
  _cache = users;
  writeUsers(users);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listUsers(): SafeUser[] {
  return getUsers().map(toSafe);
}

export function findUserByEmail(email: string): User | undefined {
  return getUsers().find((u) => u.email === email.trim().toLowerCase());
}

export function findUserById(id: string): User | undefined {
  return getUsers().find((u) => u.id === id);
}

export async function verifyPassword(user: User, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.passwordHash);
}

export async function createUser(
  email: string,
  password: string,
  name: string,
  role: UserRole = "viewer"
): Promise<SafeUser> {
  const users = getUsers();
  const normalized = email.trim().toLowerCase();

  if (users.find((u) => u.email === normalized)) {
    throw new Error("Un utilisateur avec cet email existe déjà");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user: User = {
    id: crypto.randomUUID(),
    email: normalized,
    name: name.trim(),
    passwordHash,
    role,
    createdAt: new Date().toISOString(),
  };

  persist([...users, user]);
  console.log(`[users] Created user: ${user.email} (${user.role})`);
  return toSafe(user);
}

export async function updateUser(
  id: string,
  updates: { name?: string; role?: UserRole; password?: string }
): Promise<SafeUser> {
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error("Utilisateur introuvable");

  const user = { ...users[idx] };

  if (updates.name !== undefined) user.name = updates.name.trim();
  if (updates.role !== undefined) user.role = updates.role;
  if (updates.password) {
    user.passwordHash = await bcrypt.hash(updates.password, 10);
  }

  const updated = [...users];
  updated[idx] = user;
  persist(updated);
  console.log(`[users] Updated user: ${user.email}`);
  return toSafe(user);
}

export function deleteUser(id: string): boolean {
  const users = getUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return false;

  // Prevent deleting the last admin
  const admins = users.filter((u) => u.role === "admin");
  if (user.role === "admin" && admins.length <= 1) {
    throw new Error("Impossible de supprimer le dernier administrateur");
  }

  persist(users.filter((u) => u.id !== id));
  console.log(`[users] Deleted user: ${user.email}`);
  return true;
}

export function recordLogin(id: string) {
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) return;
  const updated = [...users];
  updated[idx] = { ...updated[idx], lastLogin: new Date().toISOString() };
  persist(updated);
}

export function toSafe(user: User): SafeUser {
  const { passwordHash: _, ...safe } = user;
  return safe;
}
