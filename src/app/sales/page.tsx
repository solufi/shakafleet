import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SalesAnalyticsClient } from "./sales-analytics-client";

export default function SalesPage() {
  const jar = cookies();
  const session = jar.get("shaka_admin")?.value;
  if (!session) redirect("/login");

  let isAdmin = false;
  try {
    const parsed = JSON.parse(session);
    isAdmin = parsed.role === "admin";
  } catch {}

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Shaka Distribution" className="h-9 w-auto" />
            <div className="leading-tight">
              <div className="text-sm text-slate-300">Shaka</div>
              <div className="text-lg font-semibold tracking-tight">Fleet Manager</div>
            </div>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <Link className="hover:text-white" href="/">Dashboard</Link>
            <Link className="hover:text-white" href="/machines">Machines</Link>
            <Link className="hover:text-white" href="/products">Produits</Link>
            <Link className="text-white font-medium" href="/sales">Ventes</Link>
            <Link className="hover:text-white" href="/analytics">Analytics</Link>
            <Link className="hover:text-white" href="/users">Users</Link>
          </nav>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10">
              Logout
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <SalesAnalyticsClient isAdmin={isAdmin} />
      </main>
    </div>
  );
}
