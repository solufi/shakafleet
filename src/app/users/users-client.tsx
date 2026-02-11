"use client";

import { useEffect, useState } from "react";

type User = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "viewer";
  createdAt: string;
  lastLogin?: string;
};

export function UsersClient({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "viewer">("viewer");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit form
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<"admin" | "viewer">("viewer");
  const [editPassword, setEditPassword] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Erreur");
      setUsers(data.users || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsers();
  }, []);

  const handleCreate = async () => {
    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, password: newPassword, name: newName, role: newRole }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Erreur");
      setNewEmail("");
      setNewName("");
      setNewPassword("");
      setNewRole("viewer");
      setShowCreate(false);
      await fetchUsers();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!editingUser) return;
    setEditLoading(true);
    setEditError(null);
    try {
      const body: Record<string, string> = { id: editingUser.id, name: editName, role: editRole };
      if (editPassword.trim()) body.password = editPassword;
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Erreur");
      setEditingUser(null);
      setEditPassword("");
      await fetchUsers();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async (user: User) => {
    if (!window.confirm(`Supprimer l'utilisateur ${user.name} (${user.email}) ?`)) return;
    try {
      const res = await fetch(`/api/users?id=${encodeURIComponent(user.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Erreur");
      await fetchUsers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erreur");
    }
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditRole(user.role);
    setEditPassword("");
    setEditError(null);
  };

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Utilisateurs</h1>
          <p className="mt-1 text-sm text-slate-300">
            Gestion des comptes d'accès au Fleet Manager.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setShowCreate(!showCreate); setCreateError(null); }}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          {showCreate ? "Annuler" : "➕ Nouvel utilisateur"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-slate-900/40 p-5">
          <h2 className="text-lg font-medium mb-4">Nouvel utilisateur</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Nom</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                placeholder="Jean Dupont"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Email</label>
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                type="email"
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                placeholder="jean@shakadistribution.ca"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Mot de passe</label>
              <input
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                type="password"
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                placeholder="Min. 6 caractères"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Rôle</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "admin" | "viewer")}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
              >
                <option value="viewer">Viewer (lecture seule)</option>
                <option value="admin">Admin (gestion complète)</option>
              </select>
            </div>
          </div>
          {createError && (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {createError}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={createLoading || !newEmail || !newPassword || !newName}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {createLoading ? "Création..." : "Créer l'utilisateur"}
            </button>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-lg font-medium mb-4">Modifier: {editingUser.email}</h2>
            <div className="grid gap-4">
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Nom</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Rôle</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as "admin" | "viewer")}
                  className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                  disabled={editingUser.id === currentUserId}
                >
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
                {editingUser.id === currentUserId && (
                  <span className="text-xs text-slate-500">Vous ne pouvez pas changer votre propre rôle</span>
                )}
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Nouveau mot de passe (laisser vide pour ne pas changer)</label>
                <input
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  type="password"
                  className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                  placeholder="Nouveau mot de passe"
                />
              </div>
            </div>
            {editError && (
              <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {editError}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleEdit}
                disabled={editLoading}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {editLoading ? "Enregistrement..." : "Enregistrer"}
              </button>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Users table */}
      {loading ? (
        <div className="text-sm text-slate-400">Chargement...</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs text-slate-400">
                <th className="px-4 py-3 font-medium">Nom</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Rôle</th>
                <th className="px-4 py-3 font-medium">Dernière connexion</th>
                <th className="px-4 py-3 font-medium">Créé le</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 text-white font-medium">
                    {user.name}
                    {user.id === currentUserId && (
                      <span className="ml-2 rounded-full bg-brand-600/20 px-2 py-0.5 text-[10px] text-brand-400">
                        Vous
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300 font-mono text-xs">{user.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.role === "admin"
                          ? "bg-purple-500/20 text-purple-300"
                          : "bg-slate-500/20 text-slate-300"
                      }`}
                    >
                      {user.role === "admin" ? "Admin" : "Viewer"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {user.lastLogin ? new Date(user.lastLogin).toLocaleString("fr-FR") : "Jamais"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {new Date(user.createdAt).toLocaleDateString("fr-FR")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(user)}
                        className="rounded-md border border-white/10 px-2 py-1 text-xs text-white hover:bg-white/10"
                      >
                        Modifier
                      </button>
                      {user.id !== currentUserId && (
                        <button
                          type="button"
                          onClick={() => handleDelete(user)}
                          className="rounded-md border border-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                        >
                          Supprimer
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Aucun utilisateur. Créez le premier compte.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
