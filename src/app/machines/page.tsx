import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { machinesDB } from "../../lib/machines";
import { MachinesClient } from "./machines-client";

export default async function MachinesPage() {
  const jar = cookies();
  const session = jar.get("shaka_admin")?.value;
  if (!session) redirect("/login");

  // Valeur initiale (évite erreurs de sérialisation Date) — le vrai refresh se fait côté client
  const machines = Object.values(machinesDB).map((m: any) => ({
    ...m,
    lastSeen: m.lastSeen instanceof Date ? m.lastSeen.toISOString() : m.lastSeen,
    firstSeen: m.firstSeen instanceof Date ? m.firstSeen.toISOString() : m.firstSeen,
  }));

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
              <div className="text-lg font-semibold tracking-tight">Machines</div>
            </div>
          </div>

          <nav className="flex items-center gap-4 text-sm text-slate-300">
            <Link className="hover:text-white" href="/">
              Dashboard
            </Link>
            <Link className="hover:text-white" href="/products">
              Produits
            </Link>
            <Link className="hover:text-white" href="/sales">
              Ventes
            </Link>
            <Link className="hover:text-white" href="/agents">
              Agents
            </Link>
            <Link className="hover:text-white" href="/analytics">
              Analytics
            </Link>
            <Link className="hover:text-white" href="/users">
              Users
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <MachinesClient initialMachines={machines} />
      </main>
    </div>
  );
}
