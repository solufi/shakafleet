import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

export default function AgentsPage() {
  const jar = cookies();
  const session = jar.get("shaka_admin")?.value;
  if (!session) redirect("/login");

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
              <div className="text-lg font-semibold tracking-tight">Agents</div>
            </div>
          </div>

          <nav className="flex items-center gap-4 text-sm text-slate-300">
            <Link className="hover:text-white" href="/">
              Dashboard
            </Link>
            <Link className="hover:text-white" href="/machines">
              Machines
            </Link>
            <Link className="hover:text-white" href="/analytics">
              Analytics
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-slate-300">
            Gestion des agents (RPi): heartbeats, versions, commandes et OTA.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
            <div className="text-sm font-medium text-slate-200">Sécurité (mTLS)</div>
            <p className="mt-3 text-sm text-slate-300">
              Le endpoint agent est protégé par mTLS sur <span className="font-mono">agent.shakadistribution.ca</span>.
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <a className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10" href="/api/agent/heartbeat">
                /api/agent/heartbeat
              </a>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
            <div className="text-sm font-medium text-slate-200">À venir</div>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
              <li>Inventaire des versions (agent + compose)</li>
              <li>Commandes (pull model) + résultats</li>
              <li>OTA updates (docker compose pull/up à distance)</li>
              <li>Logs + artefacts (MinIO)</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
