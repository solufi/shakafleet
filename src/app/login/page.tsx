"use client";

import type { FormEvent } from "react";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Login failed");
        return;
      }

      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur px-6 py-8 shadow-xl">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              onError={(e) => {
                e.currentTarget.src = "/logo.svg";
              }}
              alt="Shaka Distribution"
              className="h-12 w-auto"
            />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Shaka Fleet</h1>
              <p className="text-sm text-slate-300">Admin login</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="mt-6 grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm text-slate-200">Email</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="username"
                required
                className="h-11 rounded-xl bg-slate-950/50 px-4 text-slate-100 placeholder:text-slate-500 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                placeholder="info@shakadistribution.ca"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm text-slate-200">Password</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                required
                className="h-11 rounded-xl bg-slate-950/50 px-4 text-slate-100 placeholder:text-slate-500 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                placeholder="••••••••••"
              />
            </div>

            {error ? (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="h-11 rounded-xl bg-brand-600 font-medium text-white shadow hover:bg-brand-500 disabled:opacity-60"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Secure admin access for machine fleet operations.
        </p>
      </div>
    </main>
  );
}
