"use client";

import { useEffect, useState } from "react";

type DailySummary = {
  date: string;
  totalSales: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  avgMargin: number;
  transactions: number;
  byMachine: Record<string, { revenue: number; cost: number; profit: number; count: number }>;
  byProduct: Record<string, { name: string; revenue: number; cost: number; profit: number; count: number }>;
  byPayment: Record<string, { revenue: number; count: number }>;
};

type OverallStats = {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  totalSales: number;
  transactions: number;
  avgMargin: number;
  avgOrderValue: number;
  topProducts: { name: string; revenue: number; profit: number; count: number }[];
  topMachines: { machineId: string; revenue: number; profit: number; count: number }[];
};

type Sale = {
  id: string;
  machineId: string;
  productName: string;
  sku?: string;
  price: number;
  cost: number;
  profit: number;
  quantity: number;
  paymentMethod: string;
  timestamp: string;
  date: string;
};

// ---------------------------------------------------------------------------
// SVG Bar Chart component
// ---------------------------------------------------------------------------
function BarChart({
  data,
  width = 700,
  height = 220,
  barColor = "#22c55e",
  secondaryColor = "#3b82f6",
  showSecondary = false,
}: {
  data: { label: string; value: number; secondary?: number }[];
  width?: number;
  height?: number;
  barColor?: string;
  secondaryColor?: string;
  showSecondary?: boolean;
}) {
  if (data.length === 0) return <div className="text-sm text-slate-500 text-center py-8">Aucune donnée</div>;

  const maxVal = Math.max(...data.map((d) => Math.max(d.value, d.secondary || 0)), 1);
  const barWidth = Math.max(8, Math.min(40, (width - 60) / data.length - 4));
  const chartH = height - 40;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
        <g key={pct}>
          <line x1="50" y1={10 + chartH * (1 - pct)} x2={width - 10} y2={10 + chartH * (1 - pct)}
            stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <text x="45" y={14 + chartH * (1 - pct)} textAnchor="end" fill="#64748b" fontSize="9">
            ${(maxVal * pct).toFixed(0)}
          </text>
        </g>
      ))}
      {/* Bars */}
      {data.map((d, i) => {
        const x = 55 + i * ((width - 65) / data.length);
        const h1 = (d.value / maxVal) * chartH;
        const h2 = showSecondary && d.secondary ? (d.secondary / maxVal) * chartH : 0;
        return (
          <g key={i}>
            {showSecondary && d.secondary != null && (
              <rect x={x} y={10 + chartH - h2} width={barWidth / 2 - 1} height={h2}
                fill={secondaryColor} rx="2" opacity="0.7" />
            )}
            <rect x={showSecondary ? x + barWidth / 2 : x} y={10 + chartH - h1}
              width={showSecondary ? barWidth / 2 - 1 : barWidth} height={h1}
              fill={barColor} rx="2" opacity="0.85" />
            <text x={x + barWidth / 2} y={height - 2} textAnchor="middle" fill="#94a3b8" fontSize="8">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Donut Chart component
// ---------------------------------------------------------------------------
function DonutChart({
  data,
  size = 160,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return <div className="text-sm text-slate-500 text-center py-4">Aucune donnée</div>;

  const r = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2;
  let cumAngle = -Math.PI / 2;

  const arcs = data.map((d) => {
    const angle = (d.value / total) * Math.PI * 2;
    const startX = cx + r * Math.cos(cumAngle);
    const startY = cy + r * Math.sin(cumAngle);
    cumAngle += angle;
    const endX = cx + r * Math.cos(cumAngle);
    const endY = cy + r * Math.sin(cumAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    return {
      ...d,
      path: `M ${cx} ${cy} L ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY} Z`,
      pct: ((d.value / total) * 100).toFixed(0),
    };
  });

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map((a, i) => (
          <path key={i} d={a.path} fill={a.color} stroke="#0f172a" strokeWidth="2" />
        ))}
        <circle cx={cx} cy={cy} r={r * 0.55} fill="#0f172a" />
        <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize="16" fontWeight="600">
          ${total.toFixed(0)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#94a3b8" fontSize="9">
          total
        </text>
      </svg>
      <div className="grid gap-1.5">
        {arcs.map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: a.color }} />
            <span className="text-slate-300">{a.label}</span>
            <span className="text-slate-500">{a.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function SalesAnalyticsClient({ isAdmin }: { isAdmin: boolean }) {
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [stats, setStats] = useState<OverallStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Date range
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const [fromDate, setFromDate] = useState(thirtyDaysAgo.toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(today.toISOString().slice(0, 10));
  const [machineFilter, setMachineFilter] = useState("");

  // Record sale form
  const [showRecordSale, setShowRecordSale] = useState(false);
  const [saleForm, setSaleForm] = useState({
    machineId: "", productName: "", sku: "", price: 0, cost: 0, quantity: 1, paymentMethod: "card",
  });
  const [savingSale, setSavingSale] = useState(false);

  // Recent sales
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate, view: "daily" });
      if (machineFilter) params.set("machineId", machineFilter);

      const res = await fetch(`/api/sales?${params}&v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Erreur chargement");
      const data = await res.json();
      setSummaries(data.summaries || []);
      setStats(data.stats || null);
    } catch (e: any) {
      setError(e.message || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const fetchRecent = async () => {
    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate, view: "raw" });
      if (machineFilter) params.set("machineId", machineFilter);
      const res = await fetch(`/api/sales?${params}&v=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setRecentSales((data.sales || []).reverse().slice(0, 50));
      }
    } catch {}
  };

  useEffect(() => { void fetchData(); }, [fromDate, toDate, machineFilter]);

  const handleRecordSale = async () => {
    setSavingSale(true);
    try {
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saleForm),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setShowRecordSale(false);
      setSaleForm({ machineId: "", productName: "", sku: "", price: 0, cost: 0, quantity: 1, paymentMethod: "card" });
      await fetchData();
    } catch (e: any) {
      alert(e.message || "Erreur");
    } finally {
      setSavingSale(false);
    }
  };

  // Quick date presets
  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    setFromDate(start.toISOString().slice(0, 10));
    setToDate(end.toISOString().slice(0, 10));
  };

  // Chart data
  const revenueChartData = summaries.map((s) => ({
    label: s.date.slice(5), // "MM-DD"
    value: s.totalRevenue,
    secondary: s.totalProfit,
  }));

  const marginChartData = summaries.map((s) => ({
    label: s.date.slice(5),
    value: s.avgMargin,
  }));

  // Payment method colors
  const paymentColors: Record<string, string> = {
    card: "#3b82f6", nayax: "#8b5cf6", cash: "#22c55e", free: "#f59e0b", other: "#6b7280",
  };

  // Aggregate payment data from all summaries
  const paymentAgg: Record<string, number> = {};
  for (const s of summaries) {
    for (const [method, data] of Object.entries(s.byPayment)) {
      paymentAgg[method] = (paymentAgg[method] || 0) + data.revenue;
    }
  }
  const paymentChartData = Object.entries(paymentAgg).map(([method, revenue]) => ({
    label: method, value: revenue, color: paymentColors[method] || "#6b7280",
  }));

  if (loading && summaries.length === 0) {
    return <div className="text-slate-400 text-sm">Chargement des ventes...</div>;
  }

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Ventes & Profits</h1>
            <p className="mt-1 text-sm text-slate-400">Analyse des ventes, marges et revenus par jour.</p>
          </div>
          {isAdmin && (
            <button type="button" onClick={() => setShowRecordSale(true)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700">
              + Enregistrer une vente
            </button>
          )}
        </div>
      </div>

      {/* Date filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Du</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Au</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
        </div>
        <div className="flex gap-1.5">
          {[{ label: "7j", days: 7 }, { label: "30j", days: 30 }, { label: "90j", days: 90 }, { label: "1an", days: 365 }].map((p) => (
            <button key={p.days} type="button" onClick={() => setPreset(p.days)}
              className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10">
              {p.label}
            </button>
          ))}
        </div>
        <input type="text" placeholder="Machine ID..." value={machineFilter}
          onChange={(e) => setMachineFilter(e.target.value)}
          className="h-9 w-40 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500 placeholder:text-slate-500" />
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {/* KPI Cards */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Revenus</div>
            <div className="mt-1 text-xl font-semibold text-green-400">${stats.totalRevenue.toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Co&ucirc;ts</div>
            <div className="mt-1 text-xl font-semibold text-red-400">${stats.totalCost.toFixed(2)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Profits</div>
            <div className={`mt-1 text-xl font-semibold ${stats.totalProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
              ${stats.totalProfit.toFixed(2)}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Marge moy.</div>
            <div className={`mt-1 text-xl font-semibold ${stats.avgMargin >= 30 ? "text-green-400" : stats.avgMargin >= 15 ? "text-orange-400" : "text-red-400"}`}>
              {stats.avgMargin.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Unit&eacute;s vendues</div>
            <div className="mt-1 text-xl font-semibold text-white">{stats.totalSales}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Transactions</div>
            <div className="mt-1 text-xl font-semibold text-white">{stats.transactions}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Panier moy.</div>
            <div className="mt-1 text-xl font-semibold text-white">${stats.avgOrderValue.toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        {/* Revenue + Profit chart */}
        <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-slate-900/40 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-white">Revenus & Profits par jour</h3>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-green-500" /> Revenus</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-blue-500" /> Profits</span>
            </div>
          </div>
          <BarChart data={revenueChartData} barColor="#22c55e" secondaryColor="#3b82f6" showSecondary />
        </div>

        {/* Payment methods donut */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
          <h3 className="text-sm font-medium text-white mb-3">M&eacute;thodes de paiement</h3>
          <DonutChart data={paymentChartData} />
        </div>
      </div>

      {/* Margin chart */}
      <div className="mb-6 rounded-2xl border border-white/10 bg-slate-900/40 p-5">
        <h3 className="text-sm font-medium text-white mb-3">Marge (%) par jour</h3>
        <BarChart data={marginChartData} barColor="#f59e0b" height={160} />
      </div>

      {/* Top products + Top machines */}
      {stats && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {/* Top products */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
            <h3 className="text-sm font-medium text-white mb-3">Top Produits</h3>
            {stats.topProducts.length === 0 ? (
              <div className="text-sm text-slate-500">Aucune vente</div>
            ) : (
              <div className="grid gap-2">
                {stats.topProducts.map((p, i) => {
                  const margin = p.revenue > 0 ? ((p.profit / p.revenue) * 100).toFixed(0) : "0";
                  return (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-slate-500 w-4">{i + 1}</span>
                        <span className="text-sm text-white">{p.name}</span>
                        <span className="text-[10px] text-slate-500">&times;{p.count}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-green-400">${p.revenue.toFixed(2)}</span>
                        <span className={`${Number(margin) >= 30 ? "text-green-400" : "text-orange-400"}`}>{margin}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top machines */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
            <h3 className="text-sm font-medium text-white mb-3">Top Machines</h3>
            {stats.topMachines.length === 0 ? (
              <div className="text-sm text-slate-500">Aucune vente</div>
            ) : (
              <div className="grid gap-2">
                {stats.topMachines.map((m, i) => {
                  const margin = m.revenue > 0 ? ((m.profit / m.revenue) * 100).toFixed(0) : "0";
                  return (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-slate-500 w-4">{i + 1}</span>
                        <span className="text-sm text-white font-mono">{m.machineId}</span>
                        <span className="text-[10px] text-slate-500">&times;{m.count}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-green-400">${m.revenue.toFixed(2)}</span>
                        <span className={`${Number(margin) >= 30 ? "text-green-400" : "text-orange-400"}`}>{margin}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Daily breakdown table */}
      <div className="mb-6 rounded-2xl border border-white/10 overflow-hidden">
        <div className="flex items-center justify-between bg-slate-900/60 px-5 py-3 border-b border-white/10">
          <h3 className="text-sm font-medium text-white">D&eacute;tail par jour</h3>
          <button type="button" onClick={() => { setShowRecent(!showRecent); if (!showRecent) fetchRecent(); }}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 hover:bg-white/10">
            {showRecent ? "Vue journalière" : "Voir transactions"}
          </button>
        </div>

        {!showRecent ? (
          summaries.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">Aucune vente pour cette période.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-slate-900/40">
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-400">Date</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Ventes</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Revenus</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Co&ucirc;ts</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Profits</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Marge</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Txns</th>
                </tr>
              </thead>
              <tbody>
                {[...summaries].reverse().map((s) => (
                  <tr key={s.date} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2 font-mono text-slate-300">{s.date}</td>
                    <td className="px-4 py-2 text-right text-white">{s.totalSales}</td>
                    <td className="px-4 py-2 text-right text-green-400">${s.totalRevenue.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right text-red-400">${s.totalCost.toFixed(2)}</td>
                    <td className={`px-4 py-2 text-right font-medium ${s.totalProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                      ${s.totalProfit.toFixed(2)}
                    </td>
                    <td className={`px-4 py-2 text-right ${s.avgMargin >= 30 ? "text-green-400" : s.avgMargin >= 15 ? "text-orange-400" : "text-red-400"}`}>
                      {s.avgMargin.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-right text-slate-400">{s.transactions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          recentSales.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">Aucune transaction.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-slate-900/40">
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-400">Date/Heure</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-400">Machine</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-400">Produit</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Prix</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Co&ucirc;t</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Profit</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-slate-400">Qté</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-slate-400">Paiement</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map((s) => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-2 font-mono text-xs text-slate-400">{s.timestamp.replace("T", " ").slice(0, 19)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-300">{s.machineId}</td>
                    <td className="px-4 py-2 text-white">{s.productName}</td>
                    <td className="px-4 py-2 text-right text-green-400">${s.price.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right text-slate-400">${s.cost.toFixed(2)}</td>
                    <td className={`px-4 py-2 text-right font-medium ${s.profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                      ${s.profit.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-center text-white">{s.quantity}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        s.paymentMethod === "card" ? "bg-blue-500/20 text-blue-400" :
                        s.paymentMethod === "nayax" ? "bg-purple-500/20 text-purple-400" :
                        s.paymentMethod === "cash" ? "bg-green-500/20 text-green-400" :
                        "bg-slate-500/20 text-slate-400"
                      }`}>
                        {s.paymentMethod}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {/* Record sale modal */}
      {showRecordSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-medium text-white mb-4">Enregistrer une vente</h3>
            <div className="grid gap-3">
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Machine ID *</label>
                <input value={saleForm.machineId} onChange={(e) => setSaleForm((f) => ({ ...f, machineId: e.target.value }))}
                  className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                  placeholder="Shaka-PS" />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Produit *</label>
                <input value={saleForm.productName} onChange={(e) => setSaleForm((f) => ({ ...f, productName: e.target.value }))}
                  className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1">
                  <label className="text-xs text-slate-400">Prix ($)</label>
                  <input type="number" step="0.01" value={saleForm.price}
                    onChange={(e) => setSaleForm((f) => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
                    className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-slate-400">Co&ucirc;t ($)</label>
                  <input type="number" step="0.01" value={saleForm.cost}
                    onChange={(e) => setSaleForm((f) => ({ ...f, cost: parseFloat(e.target.value) || 0 }))}
                    className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-slate-400">Qté</label>
                  <input type="number" value={saleForm.quantity}
                    onChange={(e) => setSaleForm((f) => ({ ...f, quantity: parseInt(e.target.value) || 1 }))}
                    className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
                </div>
              </div>
              {saleForm.price > 0 && saleForm.cost > 0 && (
                <div className="rounded-lg bg-slate-800/40 px-3 py-2 text-xs text-slate-400">
                  Profit: <span className="text-green-400 font-medium">${((saleForm.price - saleForm.cost) * saleForm.quantity).toFixed(2)}</span>
                  {" "}&bull; Marge: <span className="font-medium">{((saleForm.price - saleForm.cost) / saleForm.price * 100).toFixed(0)}%</span>
                </div>
              )}
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Paiement</label>
                <select value={saleForm.paymentMethod}
                  onChange={(e) => setSaleForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500">
                  <option value="card">Carte</option>
                  <option value="nayax">Nayax</option>
                  <option value="cash">Cash</option>
                  <option value="free">Gratuit</option>
                  <option value="other">Autre</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={handleRecordSale}
                disabled={savingSale || !saleForm.machineId || !saleForm.productName || saleForm.price <= 0}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50">
                {savingSale ? "Enregistrement..." : "Enregistrer"}
              </button>
              <button type="button" onClick={() => setShowRecordSale(false)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/10">
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
