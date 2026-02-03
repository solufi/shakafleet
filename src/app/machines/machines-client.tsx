"use client";

import { useEffect, useMemo, useState } from "react";

type Machine = {
  id: string;
  name?: string;
  status?: "online" | "offline" | string;
  lastSeen?: string | Date;
  uptime?: string;
  inventory?: Record<string, number>;
  cameraSnapshot?: string;
  sensors?: { temp?: number; humidity?: number; doorOpen?: boolean };
  firmware?: string;
  location?: string;
};

function MachineCard({ machine }: { machine: Machine }) {
  const isOnline = machine.status === "online";
  const totalStock = Object.values(machine.inventory || {}).reduce((a: number, b: any) => a + (b as number), 0);
  const lowStock = Object.entries(machine.inventory || {}).filter(([_, qty]) => (qty as number) < 5);
  const doorOpen = machine.sensors?.doorOpen;
  const snapshotSrc = machine.cameraSnapshot ? `${machine.cameraSnapshot}?v=${encodeURIComponent(String(machine.lastSeen || Date.now()))}` : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 transition hover:border-white/20">
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
          <div className={`h-2 w-2 rounded-full ${isOnline ? "bg-green-400" : "bg-red-400"}`} />
          <span className={`text-xs font-medium ${isOnline ? "text-green-400" : "text-red-400"}`}>
            {isOnline ? "En ligne" : "Hors ligne"}
          </span>
        </div>
      </div>

      {snapshotSrc ? (
        <div className="mt-4">
          <img
            src={snapshotSrc}
            alt={`Snapshot ${machine.id}`}
            className="h-32 w-full rounded-lg object-cover border border-white/10"
          />
        </div>
      ) : (
        <div className="mt-4 flex h-32 w-full items-center justify-center rounded-lg border border-white/10 bg-slate-800/40 text-sm text-slate-400">
          Caméra indisponible
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <span className="text-slate-400">Dernière activité</span>
          <div className="text-white">
            {machine.lastSeen ? new Date(machine.lastSeen).toLocaleString("fr-FR") : "N/A"}
          </div>
        </div>
        <div>
          <span className="text-slate-400">Uptime</span>
          <div className="text-white">{machine.uptime || "N/A"}</div>
        </div>
        <div>
          <span className="text-slate-400">Stock total</span>
          <div className="text-white">{totalStock > 0 ? `${totalStock} produits` : "N/A"}</div>
        </div>
        <div>
          <span className="text-slate-400">Firmware</span>
          <div className="text-white">{machine.firmware || "N/A"}</div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-slate-800/40 p-3">
        <div className="text-xs text-white">
          🌡️ {machine.sensors?.temp ?? "N/A"}°C • 💧 {machine.sensors?.humidity ?? "N/A"}%
        </div>

        <div
          className={
            "rounded-md px-3 py-1 text-sm font-bold tracking-wide " +
            (doorOpen === true
              ? "bg-red-500/20 text-red-300 border border-red-500/30"
              : doorOpen === false
                ? "bg-green-500/20 text-green-300 border border-green-500/30"
                : "bg-slate-700/30 text-slate-200 border border-white/10")
          }
        >
          {doorOpen === true ? "PORTE OUVERTE" : doorOpen === false ? "PORTE FERMÉE" : "PORTE N/A"}
        </div>
      </div>

      {lowStock.length > 0 && (
        <div className="mt-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-2 text-xs">
          <span className="text-yellow-400">⚠️ Stock bas:</span>{" "}
          {lowStock.map(([product]) => product as string).join(", ")}
        </div>
      )}

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

export function MachinesClient({ initialMachines }: { initialMachines: Machine[] }) {
  const [machines, setMachines] = useState<Machine[]>(initialMachines);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deleteMachine = async (id: string) => {
    const ok = window.confirm(`Supprimer la machine ${id} ?`);
    if (!ok) return;

    setError(null);
    try {
      const res = await fetch(`/api/machines?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMachines((prev) => prev.filter((m) => m.id !== id));
      setLastRefreshAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const stats = useMemo(() => {
    const total = machines.length;
    const online = machines.filter((m) => m.status === "online").length;
    const offline = machines.filter((m) => m.status === "offline").length;
    const lowStock = machines.filter((m) =>
      Object.values(m.inventory || {}).some((qty: any) => (qty as number) < 5)
    ).length;
    return { total, online, offline, lowStock };
  }, [machines]);

  const refreshMachines = async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const res = await fetch(`/api/machines?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json)) throw new Error("Invalid response");
      setMachines(json);
      setLastRefreshAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshMachines();
    const id = window.setInterval(() => {
      void refreshMachines();
    }, 10000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Machines</h1>
          <p className="mt-1 text-sm text-slate-300">Gestion du parc, inventaire et santé des machines.</p>
          <div className="mt-2 text-xs text-slate-400">
            Dernier refresh: {lastRefreshAt ? lastRefreshAt.toLocaleTimeString("fr-FR") : "—"}
            {error ? <span className="ml-2 text-red-400">(Erreur: {error})</span> : null}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void refreshMachines()}
            disabled={isRefreshing}
            className="rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-60"
          >
            <span className={isRefreshing ? "inline-block animate-spin" : ""}>🔄</span> Actualiser
          </button>
          <button className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700">
            ➕ Ajouter une machine
          </button>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">Total machines</div>
          <div className="mt-1 text-2xl font-semibold text-white">{stats.total}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">En ligne</div>
          <div className="mt-1 text-2xl font-semibold text-green-400">{stats.online}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">Hors ligne</div>
          <div className="mt-1 text-2xl font-semibold text-red-400">{stats.offline}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">Alertes stock</div>
          <div className="mt-1 text-2xl font-semibold text-yellow-400">{stats.lowStock}</div>
        </div>
      </div>

      {machines.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-6 text-slate-300">
          Aucune machine pour le moment. Clique sur "Actualiser" ou attends quelques secondes.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {machines.map((machine) => (
            <div key={machine.id} className="relative">
              <div className="absolute right-3 top-3 z-10">
                <button
                  type="button"
                  onClick={() => void deleteMachine(machine.id)}
                  className="rounded-md border border-white/20 bg-slate-950/60 px-2 py-1 text-xs font-medium text-white transition hover:bg-red-500/20 hover:border-red-500/30"
                >
                  Supprimer
                </button>
              </div>
              <MachineCard machine={machine} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
