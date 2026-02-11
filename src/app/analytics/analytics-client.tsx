"use client";

import { useEffect, useMemo, useState } from "react";

interface HourlyStats {
  date: string;
  hour: number;
  presence_count: number;
  engagement_count: number;
  gesture_left: number;
  gesture_right: number;
  avg_distance_mm: number;
  min_distance_mm: number;
}

interface DailyTotals {
  date: string;
  presence_count: number;
  engagement_count: number;
  gesture_left: number;
  gesture_right: number;
  gesture_total: number;
  conversion_rate: number;
}

interface ProximityEvent {
  id: number;
  timestamp: number;
  date: string;
  hour: number;
  event_type: string;
  data: string | null;
  distance_mm: number;
}

interface Machine {
  id: string;
  name: string;
  status: string;
  location?: string;
}

function StatCard({ label, value, sub, color = "text-white" }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function HourlyBar({ data, maxVal }: { data: HourlyStats; maxVal: number }) {
  const presenceH = maxVal > 0 ? (data.presence_count / maxVal) * 100 : 0;
  const engagementH = maxVal > 0 ? (data.engagement_count / maxVal) * 100 : 0;

  return (
    <div className="flex flex-col items-center gap-1" title={`${data.hour}h: ${data.presence_count} présences, ${data.engagement_count} engagements`}>
      <div className="flex h-24 w-6 flex-col-reverse items-end gap-0.5 overflow-hidden rounded-t">
        <div
          className="w-full rounded-t bg-blue-500/70 transition-all"
          style={{ height: `${presenceH}%` }}
        />
        <div
          className="w-full rounded-t bg-emerald-500/70 transition-all"
          style={{ height: `${engagementH}%` }}
        />
      </div>
      <span className="text-[10px] text-slate-500">{data.hour}h</span>
    </div>
  );
}

function EventBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    presence: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    engagement: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    gesture_left: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    gesture_right: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  };
  const labels: Record<string, string> = {
    presence: "Présence",
    engagement: "Engagement",
    gesture_left: "Geste ←",
    gesture_right: "Geste →",
  };
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${colors[type] || "bg-slate-500/20 text-slate-300 border-slate-500/30"}`}>
      {labels[type] || type}
    </span>
  );
}

export function AnalyticsClient({ machines }: { machines: Machine[] }) {
  const [selectedMachine, setSelectedMachine] = useState<string>("");
  const [period, setPeriod] = useState<"today" | "week">("today");
  const [todayData, setTodayData] = useState<{ totals: DailyTotals; hourly: HourlyStats[] } | null>(null);
  const [weekData, setWeekData] = useState<{ totals: any; daily: any[] } | null>(null);
  const [events, setEvents] = useState<ProximityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const activeMachines = useMemo(
    () => machines.filter((m) => m.status === "online"),
    [machines]
  );

  useEffect(() => {
    if (activeMachines.length > 0 && !selectedMachine) {
      setSelectedMachine(activeMachines[0].id);
    }
  }, [activeMachines, selectedMachine]);

  const fetchData = async () => {
    if (!selectedMachine) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/machines/${selectedMachine}/analytics?period=all`);
      const data = await res.json();

      if (data.error && !data.ok) {
        throw new Error(data.error);
      }

      if (data.today) {
        setTodayData({ ok: true, ...data.today });
      }
      if (data.week) {
        setWeekData({ ok: true, ...data.week });
      }
      setEvents(data.events || []);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedMachine) {
      void fetchData();
      const id = setInterval(() => void fetchData(), 30000);
      return () => clearInterval(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMachine]);

  const maxHourlyVal = useMemo(() => {
    if (!todayData?.hourly) return 1;
    return Math.max(1, ...todayData.hourly.map((h) => h.presence_count));
  }, [todayData]);

  const allHours = useMemo(() => {
    const hours: HourlyStats[] = [];
    for (let h = 0; h < 24; h++) {
      const existing = todayData?.hourly?.find((x) => x.hour === h);
      hours.push(
        existing || {
          date: todayData?.totals?.date || "",
          hour: h,
          presence_count: 0,
          engagement_count: 0,
          gesture_left: 0,
          gesture_right: 0,
          avg_distance_mm: 0,
          min_distance_mm: 0,
        }
      );
    }
    return hours;
  }, [todayData]);

  const selectedMachineObj = machines.find((m) => m.id === selectedMachine);

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-slate-300">
            Statistiques de proximité et engagement par machine.
          </p>
          {lastRefresh && (
            <div className="mt-1 text-xs text-slate-500">
              Dernière mise à jour: {lastRefresh.toLocaleTimeString("fr-FR")}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedMachine}
            onChange={(e) => setSelectedMachine(e.target.value)}
            className="rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-sm text-white"
          >
            <option value="">Sélectionner une machine</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.status === "online" ? "🟢" : "🔴"})
              </option>
            ))}
          </select>

          <button
            onClick={() => void fetchData()}
            disabled={loading || !selectedMachine}
            className="rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-60"
          >
            {loading ? "⏳" : "🔄"} Actualiser
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!selectedMachine ? (
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-8 text-center text-slate-400">
          Sélectionne une machine pour voir les statistiques de proximité.
        </div>
      ) : (
        <>
          {/* Machine info */}
          {selectedMachineObj && (
            <div className="mb-4 rounded-xl border border-white/10 bg-slate-900/30 px-4 py-3">
              <span className="text-sm font-medium text-white">{selectedMachineObj.name}</span>
              <span className="ml-3 text-xs text-slate-400">{selectedMachineObj.location || "—"}</span>
              <span className={`ml-3 inline-block rounded-full px-2 py-0.5 text-xs ${selectedMachineObj.status === "online" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}>
                {selectedMachineObj.status}
              </span>
            </div>
          )}

          {/* Period tabs */}
          <div className="mb-6 flex gap-2">
            <button
              onClick={() => setPeriod("today")}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${period === "today" ? "bg-blue-600 text-white" : "border border-white/20 text-slate-300 hover:bg-white/10"}`}
            >
              Aujourd&apos;hui
            </button>
            <button
              onClick={() => setPeriod("week")}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${period === "week" ? "bg-blue-600 text-white" : "border border-white/20 text-slate-300 hover:bg-white/10"}`}
            >
              7 derniers jours
            </button>
          </div>

          {/* Stats cards */}
          {period === "today" && todayData?.totals && (
            <>
              <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
                <StatCard
                  label="Passages"
                  value={todayData.totals.presence_count}
                  sub="personnes détectées"
                  color="text-blue-400"
                />
                <StatCard
                  label="Engagements"
                  value={todayData.totals.engagement_count}
                  sub="interactions"
                  color="text-emerald-400"
                />
                <StatCard
                  label="Taux de conversion"
                  value={`${todayData.totals.conversion_rate}%`}
                  sub="engagement / passage"
                  color={todayData.totals.conversion_rate > 30 ? "text-green-400" : todayData.totals.conversion_rate > 10 ? "text-yellow-400" : "text-red-400"}
                />
                <StatCard
                  label="Gestes"
                  value={todayData.totals.gesture_total}
                  sub={`← ${todayData.totals.gesture_left} | ${todayData.totals.gesture_right} →`}
                  color="text-purple-400"
                />
                <StatCard
                  label="Date"
                  value={todayData.totals.date}
                  color="text-slate-300"
                />
              </div>

              {/* Hourly chart */}
              <div className="mb-6 rounded-xl border border-white/10 bg-slate-900/40 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-200">Activité par heure</div>
                  <div className="flex gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full bg-blue-500" /> Passages
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Engagements
                    </span>
                  </div>
                </div>
                <div className="flex items-end gap-1 overflow-x-auto pb-2">
                  {allHours.map((h) => (
                    <HourlyBar key={h.hour} data={h} maxVal={maxHourlyVal} />
                  ))}
                </div>
              </div>
            </>
          )}

          {period === "week" && weekData?.totals && (
            <>
              <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
                <StatCard
                  label="Passages (7j)"
                  value={weekData.totals.presence_count}
                  color="text-blue-400"
                />
                <StatCard
                  label="Engagements (7j)"
                  value={weekData.totals.engagement_count}
                  color="text-emerald-400"
                />
                <StatCard
                  label="Taux de conversion"
                  value={`${weekData.totals.conversion_rate}%`}
                  color={weekData.totals.conversion_rate > 30 ? "text-green-400" : weekData.totals.conversion_rate > 10 ? "text-yellow-400" : "text-red-400"}
                />
                <StatCard
                  label="Gestes (7j)"
                  value={weekData.totals.gesture_total}
                  color="text-purple-400"
                />
                <StatCard
                  label="Période"
                  value="7 jours"
                  sub={weekData.totals.period}
                  color="text-slate-300"
                />
              </div>

              {/* Daily breakdown */}
              <div className="mb-6 rounded-xl border border-white/10 bg-slate-900/40 p-5">
                <div className="mb-3 text-sm font-medium text-slate-200">Par jour</div>
                {weekData.daily && weekData.daily.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-left text-xs text-slate-400">
                          <th className="pb-2 pr-4">Date</th>
                          <th className="pb-2 pr-4">Passages</th>
                          <th className="pb-2 pr-4">Engagements</th>
                          <th className="pb-2 pr-4">Gestes ←</th>
                          <th className="pb-2 pr-4">Gestes →</th>
                          <th className="pb-2">Conversion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weekData.daily.map((day: any) => (
                          <tr key={day.date} className="border-b border-white/5">
                            <td className="py-2 pr-4 font-mono text-slate-300">{day.date}</td>
                            <td className="py-2 pr-4 text-blue-400">{day.presence_count}</td>
                            <td className="py-2 pr-4 text-emerald-400">{day.engagement_count}</td>
                            <td className="py-2 pr-4 text-purple-400">{day.gesture_left}</td>
                            <td className="py-2 pr-4 text-amber-400">{day.gesture_right}</td>
                            <td className="py-2">
                              {day.presence_count > 0
                                ? `${((day.engagement_count / day.presence_count) * 100).toFixed(1)}%`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">Aucune donnée pour cette période.</div>
                )}
              </div>
            </>
          )}

          {/* Recent events log */}
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-200">Événements récents</div>
              <div className="text-xs text-slate-500">{events.length} événements</div>
            </div>
            {events.length > 0 ? (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {events.slice(0, 30).map((evt) => (
                  <div
                    key={evt.id}
                    className="flex items-center gap-3 rounded-lg border border-white/5 bg-slate-950/30 px-3 py-2"
                  >
                    <EventBadge type={evt.event_type} />
                    <span className="font-mono text-xs text-slate-400">
                      {new Date(evt.timestamp * 1000).toLocaleTimeString("fr-FR")}
                    </span>
                    {evt.distance_mm > 0 && (
                      <span className="text-xs text-slate-500">{evt.distance_mm}mm</span>
                    )}
                    {evt.data && (
                      <span className="truncate text-xs text-slate-500">{evt.data}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                Aucun événement enregistré. Les événements apparaîtront quand quelqu&apos;un passera devant le capteur.
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
