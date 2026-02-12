import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../../lib/session";
import { MachineDetailClient } from "./machine-detail-client";

export default async function MachineDetailPage({ params }: { params: { id: string } }) {
  const jar = cookies();
  const session = jar.get("shaka_admin")?.value;
  if (!session) redirect("/login");

  const me = await getSession();
  if (!me) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Shaka Distribution" className="h-9 w-auto" />
            <div className="leading-tight">
              <div className="text-sm text-slate-300">Shaka</div>
              <div className="text-lg font-semibold tracking-tight">Machine</div>
            </div>
          </div>
          <nav className="flex items-center gap-4 text-sm text-slate-300">
            <Link className="hover:text-white" href="/">Dashboard</Link>
            <Link className="hover:text-white" href="/machines">Machines</Link>
            <Link className="hover:text-white" href="/analytics">Analytics</Link>
            <Link className="hover:text-white" href="/users">Users</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <MachineDetailClient machineId={params.id} isAdmin={me.role === "admin"} />
      </main>
    </div>
  );
}
