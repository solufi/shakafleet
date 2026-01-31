import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

export default function HomePage() {
  const jar = cookies();
  const session = jar.get("shaka_admin")?.value;

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Shaka Distribution"
              className="h-9 w-auto"
            />
            <div className="leading-tight">
              <div className="text-sm text-slate-300">Shaka</div>
              <div className="text-lg font-semibold tracking-tight">Fleet Manager</div>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <Link className="hover:text-white" href="/machines">
              Machines
            </Link>
            <Link className="hover:text-white" href="/agents">
              Agents
            </Link>
            <a className="hover:text-white" href="/api/health">
              Health
            </a>
          </nav>

          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
            >
              Logout
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-300">
            Vue d’ensemble du parc. (MVP)
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Link
            href="/machines"
            className="group rounded-2xl border border-white/10 bg-slate-900/40 p-5 shadow-sm hover:border-white/20"
          >
            <div className="text-lg font-medium">Machines</div>
            <div className="mt-1 text-sm text-slate-300">
              Inventaire, statut, snapshots, dernière activité.
            </div>
            <div className="mt-4 text-sm text-brand-500 group-hover:text-brand-400">Open →</div>
          </Link>

          <Link
            href="/agents"
            className="group rounded-2xl border border-white/10 bg-slate-900/40 p-5 shadow-sm hover:border-white/20"
          >
            <div className="text-lg font-medium">Agents</div>
            <div className="mt-1 text-sm text-slate-300">
              Heartbeats, versions, OTA updates, sécurité mTLS.
            </div>
            <div className="mt-4 text-sm text-brand-500 group-hover:text-brand-400">Open →</div>
          </Link>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/30 p-5">
          <div className="text-sm font-medium text-slate-200">Debug endpoints</div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <a className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10" href="/api/me">
              /api/me
            </a>
            <a className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10" href="/api/health">
              /api/health
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
