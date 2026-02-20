"use client";

import { useEffect, useMemo, useState } from "react";

type Machine = {
  id: string;
  name?: string;
  status?: "online" | "offline" | "degraded" | string;
  lastSeen?: string | Date;
  firstSeen?: string | Date;
  uptime?: string;
  inventory?: {
    products?: { name?: string; location?: string; price?: number; quantity?: number }[];
    inventory?: Record<string, number>;
    totalProducts?: number;
  };
  snapshots?: Record<string, string>;
  snapshotsUpdatedAt?: string;
  sensors?: { temp?: number; humidity?: number; doorOpen?: boolean };
  firmware?: string;
  agentVersion?: string;
  location?: string;
  proximity?: {
    summary?: { presence_today?: number; engagement_today?: number; gestures_today?: number; conversion_rate?: number };
    live?: { connected?: boolean; mode?: string; presence?: { detected?: boolean; count?: number }; engagement?: string; distance_mm?: number[]; gesture?: { last?: string } };
    updatedAt?: string;
  };
  meta?: {
    ip?: string;
    publicIp?: string;
    hostname?: string;
    platform?: string;
    os?: string;
    vend_port?: number;
    services?: Record<string, string>;
    disk?: { total_gb?: number; used_gb?: number; free_gb?: number; percent?: number };
    memory?: { total_mb?: number; used_mb?: number; available_mb?: number; percent?: number };
    stripe?: { connected?: boolean; simulation?: boolean; state?: string; reader_id?: string };
  };
  source?: { forwardedFor?: string; receivedAt?: string };
};

function StatusBadge({ status }: { status?: string }) {
  const colors: Record<string, string> = {
    online: "bg-green-500/20 text-green-400 border-green-500/30",
    offline: "bg-red-500/20 text-red-400 border-red-500/30",
    degraded: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  };
  const labels: Record<string, string> = { online: "En ligne", offline: "Hors ligne", degraded: "Dégradé" };
  const c = colors[status || "offline"] || colors.offline;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${c}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === "online" ? "bg-green-400" : status === "degraded" ? "bg-yellow-400" : "bg-red-400"}`} />
      {labels[status || "offline"] || status}
    </span>
  );
}

function ServiceDot({ name, status }: { name: string; status: string }) {
  const ok = status === "active";
  return (
    <span className="inline-flex items-center gap-1 text-[10px]" title={`${name}: ${status}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-green-400" : "bg-red-400"}`} />
      <span className={ok ? "text-slate-400" : "text-red-300"}>{name.replace("shaka-", "")}</span>
    </span>
  );
}

function MachineCard({ machine }: { machine: Machine }) {
  const doorOpen = machine.sensors?.doorOpen;
  const meta = machine.meta;
  const disk = meta?.disk;
  const mem = meta?.memory;
  const stripe = meta?.stripe;
  const services = meta?.services || {};
  const prox = machine.proximity;
  const proxSummary = prox?.summary;
  const proxLive = prox?.live;
  const inv = machine.inventory;
  const totalProducts = inv?.totalProducts ?? inv?.products?.length ?? 0;
  const snapshotSrc = `/api/machines/${machine.id}/snapshot?cam=camera_0&v=${encodeURIComponent(String(machine.lastSeen || Date.now()))}`;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 transition hover:border-white/20">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{machine.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
            <span className="font-mono">{machine.id}</span>
            {machine.location && machine.location !== "Inconnue" && (
              <><span>•</span><span>{machine.location}</span></>
            )}
          </div>
        </div>
        <StatusBadge status={machine.status} />
      </div>

      {/* Camera snapshot */}
      <div className="mt-4">
        <img
          src={snapshotSrc}
          alt={`Snapshot ${machine.id}`}
          className="h-36 w-full rounded-lg object-cover border border-white/10 bg-slate-800/40"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
        {machine.snapshotsUpdatedAt && (
          <div className="mt-1 text-[10px] text-slate-500">
            Dernière capture: {new Date(machine.snapshotsUpdatedAt).toLocaleString("fr-FR")}
          </div>
        )}
      </div>

      {/* Key metrics grid */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <span className="text-slate-500">Uptime système</span>
          <div className="font-medium text-white">{machine.uptime || "N/A"}</div>
        </div>
        <div>
          <span className="text-slate-500">Dernière activité</span>
          <div className="font-medium text-white">
            {machine.lastSeen ? new Date(machine.lastSeen).toLocaleString("fr-FR") : "N/A"}
          </div>
        </div>
        <div>
          <span className="text-slate-500">Agent</span>
          <div className="font-medium text-white font-mono">v{machine.agentVersion || "?"}</div>
        </div>
        <div>
          <span className="text-slate-500">Firmware</span>
          <div className="font-medium text-white font-mono">v{machine.firmware || "?"}</div>
        </div>
      </div>

      {/* Network info */}
      <div className="mt-3 rounded-lg border border-white/5 bg-slate-800/30 p-2.5 text-xs">
        <div className="mb-1 text-[10px] font-medium text-slate-500 uppercase tracking-wider">Réseau</div>
        <div className="grid grid-cols-2 gap-1">
          <div><span className="text-slate-500">IP locale: </span><span className="font-mono text-white">{meta?.ip || "N/A"}</span></div>
          <div><span className="text-slate-500">IP publique: </span><span className="font-mono text-white">{meta?.publicIp || "N/A"}</span></div>
          <div><span className="text-slate-500">Hostname: </span><span className="font-mono text-white">{meta?.hostname || "N/A"}</span></div>
          <div><span className="text-slate-500">Arch: </span><span className="font-mono text-white">{meta?.platform || "N/A"}</span></div>
        </div>
      </div>

      {/* Door + Temperature */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-slate-800/40 p-3">
        <div className="text-xs text-white">
          🌡️ {machine.sensors?.temp ?? "N/A"}°C
        </div>
        <div
          className={
            "rounded-md px-3 py-1 text-xs font-bold tracking-wide " +
            (doorOpen === true
              ? "bg-red-500/20 text-red-300 border border-red-500/30"
              : doorOpen === false
                ? "bg-green-500/20 text-green-300 border border-green-500/30"
                : "bg-slate-700/30 text-slate-200 border border-white/10")
          }
        >
          {doorOpen === true ? "🚪 PORTE OUVERTE" : doorOpen === false ? "🔒 PORTE FERMÉE" : "PORTE N/A"}
        </div>
      </div>

      {/* System resources */}
      {(disk || mem) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {disk && (
            <div className="rounded-lg border border-white/5 bg-slate-800/30 p-2 text-xs">
              <div className="text-[10px] text-slate-500">Disque</div>
              <div className="mt-0.5 flex items-end gap-1">
                <span className={`text-sm font-semibold ${(disk.percent ?? 0) > 85 ? "text-red-400" : (disk.percent ?? 0) > 70 ? "text-yellow-400" : "text-white"}`}>
                  {disk.percent ?? 0}%
                </span>
                <span className="text-slate-500">{disk.used_gb ?? 0}/{disk.total_gb ?? 0} GB</span>
              </div>
              <div className="mt-1 h-1 w-full rounded-full bg-slate-700">
                <div className={`h-1 rounded-full ${(disk.percent ?? 0) > 85 ? "bg-red-500" : (disk.percent ?? 0) > 70 ? "bg-yellow-500" : "bg-green-500"}`} style={{ width: `${Math.min(disk.percent ?? 0, 100)}%` }} />
              </div>
            </div>
          )}
          {mem && (
            <div className="rounded-lg border border-white/5 bg-slate-800/30 p-2 text-xs">
              <div className="text-[10px] text-slate-500">Mémoire</div>
              <div className="mt-0.5 flex items-end gap-1">
                <span className={`text-sm font-semibold ${(mem.percent ?? 0) > 85 ? "text-red-400" : (mem.percent ?? 0) > 70 ? "text-yellow-400" : "text-white"}`}>
                  {mem.percent ?? 0}%
                </span>
                <span className="text-slate-500">{mem.used_mb ?? 0}/{mem.total_mb ?? 0} MB</span>
              </div>
              <div className="mt-1 h-1 w-full rounded-full bg-slate-700">
                <div className={`h-1 rounded-full ${(mem.percent ?? 0) > 85 ? "bg-red-500" : (mem.percent ?? 0) > 70 ? "bg-yellow-500" : "bg-green-500"}`} style={{ width: `${Math.min(mem.percent ?? 0, 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Inventory */}
      {totalProducts > 0 && (
        <div className="mt-3 rounded-lg border border-white/5 bg-slate-800/30 p-2.5 text-xs">
          <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Inventaire — {totalProducts} produits</div>
          {inv?.products && inv.products.length > 0 && (
            <div className="mt-1.5 grid gap-0.5 max-h-24 overflow-y-auto">
              {inv.products.slice(0, 8).map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-slate-300 truncate max-w-[60%]">{p.name || p.location || `Produit ${i + 1}`}</span>
                  <span className="font-mono text-slate-400">{p.location && <span className="text-slate-600 mr-1">{p.location}</span>}{p.price != null ? `$${(p.price / 100).toFixed(2)}` : ""}</span>
                </div>
              ))}
              {inv.products.length > 8 && (
                <div className="text-slate-500">+{inv.products.length - 8} autres...</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stripe Terminal payment */}
      {stripe && (
        <div className="mt-3 rounded-lg border border-white/5 bg-slate-800/30 p-2.5 text-xs">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Paiement Stripe</div>
            {stripe.simulation ? (
              <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-300 border border-yellow-500/20">SIMULATION</span>
            ) : stripe.connected ? (
              <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-300 border border-green-500/20">LIVE</span>
            ) : (
              <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-300 border border-red-500/20">HORS LIGNE</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${stripe.connected ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
            <span className={stripe.connected ? "text-white" : "text-red-300"}>
              {stripe.connected ? "WisePOS E connecté" : "Non connecté"}
            </span>
          </div>
          {stripe.state && stripe.state !== "idle" && (
            <div className="mt-1 text-slate-400">État: <span className="text-white">{stripe.state}</span></div>
          )}
          {stripe.reader_id && !stripe.simulation && (
            <div className="mt-1 text-slate-500">Reader: <span className="font-mono text-slate-400">{stripe.reader_id}</span></div>
          )}
        </div>
      )}

      {/* Proximity stats */}
      {proxSummary && (
        <div className="mt-3 rounded-lg border border-white/10 bg-slate-800/40 p-3">
          <div className="mb-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">Proximité (aujourd&apos;hui)</div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-lg font-semibold text-blue-400">{proxSummary.presence_today ?? 0}</div>
              <div className="text-[10px] text-slate-500">Passages</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-emerald-400">{proxSummary.engagement_today ?? 0}</div>
              <div className="text-[10px] text-slate-500">Engagements</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-purple-400">{proxSummary.gestures_today ?? 0}</div>
              <div className="text-[10px] text-slate-500">Gestes</div>
            </div>
            <div>
              <div className={`text-lg font-semibold ${(proxSummary.conversion_rate ?? 0) > 30 ? "text-green-400" : (proxSummary.conversion_rate ?? 0) > 10 ? "text-yellow-400" : "text-slate-400"}`}>
                {proxSummary.conversion_rate ?? 0}%
              </div>
              <div className="text-[10px] text-slate-500">Conversion</div>
            </div>
          </div>
          {proxLive && (
            <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${proxLive.connected ? "bg-green-400" : "bg-red-400"}`} />
              <span>Capteur {proxLive.connected ? "connecté" : "déconnecté"}</span>
              {proxLive.distance_mm && proxLive.distance_mm[0] > 0 && (
                <span>• {proxLive.distance_mm[0]}mm</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Services status */}
      {Object.keys(services).length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Services</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {Object.entries(services).map(([name, st]) => (
              <ServiceDot key={name} name={name} status={st} />
            ))}
          </div>
        </div>
      )}

      {/* Detail link */}
      <a
        href={`/machines/${machine.id}`}
        className="mt-4 block w-full rounded-lg bg-brand-600 px-3 py-2 text-center text-xs font-medium text-white transition hover:bg-brand-700"
      >
        Voir détails &amp; Produits
      </a>
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
    const degraded = machines.filter((m) => m.status === "degraded").length;
    return { total, online, offline, degraded };
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
          <div className="text-xs text-slate-400">Dégradé</div>
          <div className="mt-1 text-2xl font-semibold text-yellow-400">{stats.degraded}</div>
        </div>
      </div>

      {machines.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-6 text-slate-300">
          Aucune machine pour le moment. Clique sur &quot;Actualiser&quot; ou attends quelques secondes.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
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
