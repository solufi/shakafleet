import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { machinesDB } from "../../lib/machines";
import { AnalyticsClient } from "./analytics-client";

export default async function AnalyticsPage() {
  const jar = cookies();
  const session = jar.get("shaka_admin")?.value;
  if (!session) redirect("/login");

  const machines = Object.values(machinesDB).map((m: any) => ({
    id: m.id,
    name: m.name,
    status: m.status,
    location: m.location,
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
              <div className="text-lg font-semibold tracking-tight">Analytics</div>
            </div>
          </div>

          <nav className="flex items-center gap-4 text-sm text-slate-300">
            <Link className="hover:text-white" href="/">
              Dashboard
            </Link>
            <Link className="hover:text-white" href="/machines">
              Machines
            </Link>
            <Link className="hover:text-white" href="/agents">
              Agents
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <AnalyticsClient machines={machines} />
      </main>
    </div>
  );
}
