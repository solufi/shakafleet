import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

// À remplacer par un fetch à ton API
async function fetchMachines(filters?: {
  status?: "online" | "offline";
  location?: string;
  lowStock?: boolean;
}) {
  const sp = new URLSearchParams();
  if (filters?.status) sp.set("status", filters.status);
  if (filters?.location) sp.set("location", filters.location);
  if (filters?.lowStock) sp.set("lowStock", "true");
  // En production, remplace localhost par le vrai domaine ou utilise une variable d’env
  const baseUrl = process.env.NODE_ENV === "production" ? "https://fleet.shakadistribution.ca" : "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/machines?${sp.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch machines");
  return res.json();
}

const mockMachines: any[] = []; // plus de mock, on utilise les vraies données

function MachineCard({ machine }: { machine: any }) {
  const isOnline = machine.status === "online";
  const totalStock = Object.values(machine.inventory || {}).reduce((a: number, b: any) => a + (b as number), 0);
  const lowStock = Object.entries(machine.inventory || {}).filter(([_, qty]) => (qty as number) < 5);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 transition hover:border-white/20">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{machine.name}</h2>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <span className="font-mono">{machine.id}</span>
            <span>•</span>
            <span>{machine.location}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              isOnline ? "bg-green-500" : "bg-red-500"
            }`}
            title={isOnline ? "En ligne" : "Hors ligne"}
          />
          <span className={`text-xs ${isOnline ? "text-green-400" : "text-red-400"}`}>
            {isOnline ? "En ligne" : "Hors ligne"}
          </span>
        </div>
      </div>

      {/* Camera snapshot */}
      {machine.cameraSnapshot ? (
        <div className="mt-4">
          <img
            src={machine.cameraSnapshot}
            alt={`Snapshot ${machine.id}`}
            className="h-32 w-full rounded-lg object-cover border border-white/10"
          />
        </div>
      ) : (
        <div className="mt-4 flex h-32 w-full items-center justify-center rounded-lg border border-white/10 bg-slate-800/40 text-sm text-slate-400">
          Caméra indisponible
        </div>
      )}

      {/* Infos */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <span className="text-slate-400">Dernier contact</span>
          <div className="text-white">
            {machine.lastSeen.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        <div>
          <span className="text-slate-400">Uptime</span>
          <div className="text-white">{machine.uptime}</div>
        </div>
        <div>
          <span className="text-slate-400">Firmware</span>
          <div className="text-white">{machine.firmware}</div>
        </div>
        <div>
          <span className="text-slate-400">Stock total</span>
          <div className="text-white">{totalStock} unités</div>
        </div>
      </div>

      {/* Sensors */}
      <div className="mt-4 flex items-center gap-4 text-xs">
        <span className="text-slate-400">Sensors:</span>
        <span className="text-white">
          🌡️ {machine.sensors.temp}°C • 💧 {machine.sensors.humidity}% •
          {machine.sensors.doorOpen ? " 🚪 Ouverte" : " 🚪 Fermée"}
        </span>
      </div>

      {/* Alertes stock bas */}
      {lowStock.length > 0 && (
        <div className="mt-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-2 text-xs">
          <span className="text-yellow-400">⚠️ Stock bas:</span>{" "}
          {lowStock.map(([product]) => product as string).join(", ")}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        <button className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-brand-700">
          Voir détails
        </button>
        <button className="rounded-lg border border-white/20 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10">
          OTA
        </button>
        <button className="rounded-lg border border-white/20 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10">
          Reboot
        </button>
      </div>
    </div>
  );
}

export default async function MachinesPage() {
  const jar = cookies();
  const session = jar.get("shaka_admin")?.value;
  if (!session) redirect("/login");

  // Utilise l’API ; en cas d’erreur, fallback sur tableau vide
  let machines = [];
  try {
    machines = await fetchMachines();
  } catch (e) {
    console.error("Failed to fetch machines, using empty list", e);
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
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Machines</h1>
            <p className="mt-1 text-sm text-slate-300">
              Gestion du parc, inventaire et santé des machines.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10">
              🔄 Rafraîchir
            </button>
            <button className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700">
              ➕ Ajouter une machine
            </button>
          </div>
        </div>

        {/* Stats globales */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Total machines</div>
            <div className="mt-1 text-2xl font-semibold text-white">{machines.length}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">En ligne</div>
            <div className="mt-1 text-2xl font-semibold text-green-400">
              {machines.filter((m: any) => m.status === "online").length}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Hors ligne</div>
            <div className="mt-1 text-2xl font-semibold text-red-400">
              {machines.filter((m: any) => m.status === "offline").length}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Alertes stock</div>
            <div className="mt-1 text-2xl font-semibold text-yellow-400">
              {machines.filter((m: any) => Object.values(m.inventory || {}).some((qty: any) => qty < 5)).length}
            </div>
          </div>
        </div>

        {/* Liste des machines */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {machines.map((machine: any) => (
            <MachineCard key={machine.id} machine={machine} />
          ))}
        </div>
      </main>
    </div>
  );
}
