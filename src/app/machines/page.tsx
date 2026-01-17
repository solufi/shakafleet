import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

export default function MachinesPage() {
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
              onError={(e) => {
                e.currentTarget.src = "/logo.svg";
              }}
              alt="Shaka Distribution"
              className="h-9 w-auto"
            />
            <div className="leading-tight">
              <div className="text-sm text-slate-300">Shaka</div>
              <div className="text-lg font-semibold tracking-tight">Machines</div>
            </div>
          </div>

          <nav className="flex items-center gap-4 text-sm text-slate-300">
            <Link className="hover:text-white" href="/">
              Dashboard
            </Link>
            <Link className="hover:text-white" href="/agents">
              Agents
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Machines</h1>
          <p className="mt-1 text-sm text-slate-300">
            Gestion du parc, inventaire et santé des machines.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
            <div className="text-sm font-medium text-slate-200">À venir</div>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">
              <li>Enregistrement des machines (shaka-0001..)</li>
              <li>Dernière heartbeat / statut online/offline</li>
              <li>Snapshots caméra et logs</li>
              <li>Inventaire produits / alertes</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
            <div className="text-sm font-medium text-slate-200">Prochaine étape</div>
            <p className="mt-3 text-sm text-slate-300">
              On peut brancher le vrai modèle “fleet”: tables Postgres + endpoints admin pour lister, filtrer et voir le détail d’une machine.
            </p>
            <div className="mt-4 text-sm text-brand-500">Ready when you are.</div>
          </div>
        </div>
      </main>
    </div>
  );
}
