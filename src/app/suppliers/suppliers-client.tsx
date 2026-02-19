"use client";

import { useEffect, useState } from "react";

type PriceHistoryEntry = {
  date: string;
  cost: number;
  note?: string;
};

type SupplierProduct = {
  catalogProductId: string;
  productName: string;
  sku: string;
  currentCost: number;
  priceHistory: PriceHistoryEntry[];
};

type Supplier = {
  id: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  notes: string;
  products: SupplierProduct[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  cost: number;
};

type PriceChange = {
  productName: string;
  sku: string;
  catalogProductId: string;
  supplier: string;
  firstCost: number;
  currentCost: number;
  changePercent: number;
  totalChanges: number;
  firstDate: string;
  lastDate: string;
};

// ---------------------------------------------------------------------------
// SVG Line Chart for price history
// ---------------------------------------------------------------------------
function PriceLineChart({ history, width = 500, height = 160 }: { history: PriceHistoryEntry[]; width?: number; height?: number }) {
  if (history.length < 2) {
    return <div className="text-xs text-slate-500 text-center py-4">Pas assez de données pour un graphique (min. 2 entrées)</div>;
  }

  const costs = history.map((h) => h.cost);
  const minCost = Math.min(...costs) * 0.9;
  const maxCost = Math.max(...costs) * 1.1;
  const range = maxCost - minCost || 1;

  const padL = 50;
  const padR = 15;
  const padT = 15;
  const padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const points = history.map((h, i) => ({
    x: padL + (i / (history.length - 1)) * chartW,
    y: padT + chartH - ((h.cost - minCost) / range) * chartH,
    ...h,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padT + chartH} L ${points[0].x} ${padT + chartH} Z`;

  const firstCost = costs[0];
  const lastCost = costs[costs.length - 1];
  const isUp = lastCost > firstCost;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const y = padT + chartH * (1 - pct);
        const val = minCost + range * pct;
        return (
          <g key={pct}>
            <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={padL - 5} y={y + 3} textAnchor="end" fill="#64748b" fontSize="9">${val.toFixed(2)}</text>
          </g>
        );
      })}
      {/* Area */}
      <path d={areaPath} fill={isUp ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)"} />
      {/* Line */}
      <path d={linePath} fill="none" stroke={isUp ? "#ef4444" : "#22c55e"} strokeWidth="2" />
      {/* Points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill={isUp ? "#ef4444" : "#22c55e"} stroke="#0f172a" strokeWidth="2" />
          <text x={p.x} y={height - 4} textAnchor="middle" fill="#94a3b8" fontSize="7">
            {p.date.slice(5)}
          </text>
        </g>
      ))}
      {/* Start/End labels */}
      <text x={points[0].x} y={points[0].y - 8} textAnchor="start" fill="#94a3b8" fontSize="9" fontWeight="600">
        ${firstCost.toFixed(2)}
      </text>
      <text x={points[points.length - 1].x} y={points[points.length - 1].y - 8} textAnchor="end"
        fill={isUp ? "#ef4444" : "#22c55e"} fontSize="9" fontWeight="600">
        ${lastCost.toFixed(2)} ({isUp ? "+" : ""}{((lastCost - firstCost) / firstCost * 100).toFixed(1)}%)
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function SuppliersClient({ isAdmin }: { isAdmin: boolean }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View state
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [tab, setTab] = useState<"list" | "priceChanges">("list");

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ name: "", contact: "", email: "", phone: "", address: "", website: "", notes: "", active: true });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Add product modal
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [addCost, setAddCost] = useState(0);
  const [addNote, setAddNote] = useState("");
  const [selectedCatalogProduct, setSelectedCatalogProduct] = useState<CatalogProduct | null>(null);

  // Update cost modal
  const [costUpdate, setCostUpdate] = useState<{ product: SupplierProduct; supplierId: string } | null>(null);
  const [newCost, setNewCost] = useState(0);
  const [costNote, setCostNote] = useState("");

  // Price changes
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);

  const fetchSuppliers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/suppliers?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Erreur chargement");
      const data = await res.json();
      setSuppliers(data.suppliers || []);
    } catch (e: any) {
      setError(e.message || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  const fetchPriceChanges = async () => {
    try {
      const res = await fetch(`/api/suppliers?priceChanges=true&v=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setPriceChanges(data.priceChanges || []);
      }
    } catch {}
  };

  const fetchSupplierDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/suppliers?id=${id}&v=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setSelectedSupplier(data.supplier || null);
      }
    } catch {}
  };

  useEffect(() => { void fetchSuppliers(); void fetchPriceChanges(); }, []);

  const openCreate = () => {
    setForm({ name: "", contact: "", email: "", phone: "", address: "", website: "", notes: "", active: true });
    setEditingSupplier(null);
    setShowForm(true);
    setFormError(null);
  };

  const openEdit = (supplier: Supplier) => {
    setForm({
      name: supplier.name,
      contact: supplier.contact,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      website: supplier.website,
      notes: supplier.notes,
      active: supplier.active,
    });
    setEditingSupplier(supplier);
    setShowForm(true);
    setFormError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (editingSupplier) {
        const res = await fetch("/api/suppliers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingSupplier.id, ...form }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
      } else {
        const res = await fetch("/api/suppliers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
      }
      setShowForm(false);
      await fetchSuppliers();
    } catch (e: any) {
      setFormError(e.message || "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (supplier: Supplier) => {
    if (!window.confirm(`Supprimer le fournisseur "${supplier.name}" ?`)) return;
    try {
      const res = await fetch(`/api/suppliers?id=${supplier.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      if (selectedSupplier?.id === supplier.id) setSelectedSupplier(null);
      await fetchSuppliers();
    } catch (e: any) {
      alert(e.message || "Erreur");
    }
  };

  const openAddProduct = async () => {
    setShowAddProduct(true);
    setCatalogSearch("");
    setSelectedCatalogProduct(null);
    setAddCost(0);
    setAddNote("");
    try {
      const res = await fetch(`/api/products?activeOnly=true&v=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setCatalogProducts(data.products || []);
      }
    } catch {}
  };

  const handleAddProduct = async () => {
    if (!selectedSupplier || !selectedCatalogProduct) return;
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addProduct",
          supplierId: selectedSupplier.id,
          catalogProductId: selectedCatalogProduct.id,
          productName: selectedCatalogProduct.name,
          sku: selectedCatalogProduct.sku,
          cost: addCost,
          note: addNote,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setShowAddProduct(false);
      await fetchSupplierDetail(selectedSupplier.id);
      await fetchPriceChanges();
    } catch (e: any) {
      alert(e.message || "Erreur");
    }
  };

  const handleRemoveProduct = async (catalogProductId: string) => {
    if (!selectedSupplier) return;
    if (!window.confirm("Retirer ce produit du fournisseur ?")) return;
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "removeProduct", supplierId: selectedSupplier.id, catalogProductId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await fetchSupplierDetail(selectedSupplier.id);
    } catch (e: any) {
      alert(e.message || "Erreur");
    }
  };

  const handleUpdateCost = async () => {
    if (!costUpdate) return;
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateCost",
          supplierId: costUpdate.supplierId,
          catalogProductId: costUpdate.product.catalogProductId,
          cost: newCost,
          note: costNote,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setCostUpdate(null);
      if (selectedSupplier) await fetchSupplierDetail(selectedSupplier.id);
      await fetchPriceChanges();
    } catch (e: any) {
      alert(e.message || "Erreur");
    }
  };

  // Stats
  const totalSuppliers = suppliers.length;
  const activeSuppliers = suppliers.filter((s) => s.active).length;
  const totalLinkedProducts = suppliers.reduce((sum, s) => sum + s.products.length, 0);
  const priceIncreases = priceChanges.filter((p) => p.changePercent > 0).length;

  if (loading) return <div className="text-slate-400 text-sm">Chargement des fournisseurs...</div>;

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Fournisseurs</h1>
            <p className="mt-1 text-sm text-slate-400">Gestion des fournisseurs, prix d&apos;achat et historique d&apos;&eacute;volution.</p>
          </div>
          <div className="flex gap-2">
            {selectedSupplier && (
              <button type="button" onClick={() => setSelectedSupplier(null)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/10">
                ← Liste
              </button>
            )}
            {isAdmin && !selectedSupplier && (
              <button type="button" onClick={openCreate}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700">
                + Nouveau fournisseur
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      {!selectedSupplier && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Fournisseurs</div>
            <div className="mt-1 text-2xl font-semibold text-white">{totalSuppliers}</div>
            <div className="text-[10px] text-slate-500">{activeSuppliers} actifs</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Produits li&eacute;s</div>
            <div className="mt-1 text-2xl font-semibold text-white">{totalLinkedProducts}</div>
          </div>
          <div className={`rounded-xl border p-4 ${priceIncreases > 0 ? "border-red-500/30 bg-red-500/10" : "border-white/10 bg-slate-900/40"}`}>
            <div className="text-xs text-slate-400">Hausses de prix</div>
            <div className={`mt-1 text-2xl font-semibold ${priceIncreases > 0 ? "text-red-400" : "text-white"}`}>{priceIncreases}</div>
            <div className="text-[10px] text-slate-500">depuis le d&eacute;but</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400">Changements de prix</div>
            <div className="mt-1 text-2xl font-semibold text-white">{priceChanges.reduce((s, p) => s + p.totalChanges, 0)}</div>
            <div className="text-[10px] text-slate-500">total enregistr&eacute;s</div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {/* Tabs (list view only) */}
      {!selectedSupplier && (
        <div className="mb-4 flex gap-1">
          <button type="button" onClick={() => setTab("list")}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "list" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}>
            Fournisseurs
          </button>
          <button type="button" onClick={() => { setTab("priceChanges"); fetchPriceChanges(); }}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${tab === "priceChanges" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}>
            &Eacute;volution des prix {priceIncreases > 0 && <span className="ml-1 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400">{priceIncreases}</span>}
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* SUPPLIER DETAIL VIEW */}
      {/* ============================================================ */}
      {selectedSupplier ? (
        <div>
          {/* Supplier info card */}
          <div className="mb-6 rounded-2xl border border-white/10 bg-slate-900/40 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">{selectedSupplier.name}</h2>
                <div className="mt-2 grid gap-1 text-sm text-slate-400">
                  {selectedSupplier.contact && <div>Contact: <span className="text-slate-200">{selectedSupplier.contact}</span></div>}
                  {selectedSupplier.email && <div>Email: <span className="text-slate-200">{selectedSupplier.email}</span></div>}
                  {selectedSupplier.phone && <div>T&eacute;l: <span className="text-slate-200">{selectedSupplier.phone}</span></div>}
                  {selectedSupplier.address && <div>Adresse: <span className="text-slate-200">{selectedSupplier.address}</span></div>}
                  {selectedSupplier.website && <div>Web: <a href={selectedSupplier.website} target="_blank" rel="noopener" className="text-brand-400 hover:underline">{selectedSupplier.website}</a></div>}
                  {selectedSupplier.notes && <div className="mt-2 text-xs text-slate-500">{selectedSupplier.notes}</div>}
                </div>
              </div>
              {isAdmin && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => openEdit(selectedSupplier)}
                    className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/10">Modifier</button>
                  <button type="button" onClick={openAddProduct}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-xs text-white hover:bg-brand-700">+ Ajouter un produit</button>
                </div>
              )}
            </div>
          </div>

          {/* Products list with price history */}
          <h3 className="text-sm font-medium text-white mb-3">Produits fournis ({selectedSupplier.products.length})</h3>
          {selectedSupplier.products.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
              Aucun produit li&eacute; &agrave; ce fournisseur.
            </div>
          ) : (
            <div className="grid gap-4">
              {selectedSupplier.products.map((product) => {
                const first = product.priceHistory[0];
                const last = product.priceHistory[product.priceHistory.length - 1];
                const change = first && last && first.cost > 0 ? ((last.cost - first.cost) / first.cost * 100) : 0;
                const isUp = change > 0;

                return (
                  <div key={product.catalogProductId} className="rounded-2xl border border-white/10 bg-slate-900/40 overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                      <div>
                        <div className="font-medium text-white">{product.productName}</div>
                        <div className="text-xs text-slate-500">SKU: {product.sku}</div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-lg font-semibold text-white">${product.currentCost.toFixed(2)}</div>
                          {product.priceHistory.length > 1 && (
                            <div className={`text-xs font-medium ${isUp ? "text-red-400" : change < 0 ? "text-green-400" : "text-slate-500"}`}>
                              {isUp ? "↑" : change < 0 ? "↓" : "="} {Math.abs(change).toFixed(1)}% depuis {first?.date}
                            </div>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1">
                            <button type="button"
                              onClick={() => { setCostUpdate({ product, supplierId: selectedSupplier.id }); setNewCost(product.currentCost); setCostNote(""); }}
                              className="rounded-md border border-white/10 px-2 py-1 text-xs text-white hover:bg-white/10">
                              Maj prix
                            </button>
                            <button type="button" onClick={() => handleRemoveProduct(product.catalogProductId)}
                              className="rounded-md border border-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10">
                              &#10005;
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Price history chart */}
                    {product.priceHistory.length >= 2 && (
                      <div className="px-5 py-3 border-b border-white/5">
                        <PriceLineChart history={product.priceHistory} />
                      </div>
                    )}

                    {/* Price history table */}
                    <div className="px-5 py-3">
                      <div className="text-[10px] text-slate-500 mb-2">Historique des prix ({product.priceHistory.length} entr&eacute;e{product.priceHistory.length > 1 ? "s" : ""})</div>
                      <div className="grid gap-1">
                        {[...product.priceHistory].reverse().map((entry, i) => {
                          const prev = product.priceHistory[product.priceHistory.length - 1 - i - 1];
                          const diff = prev ? entry.cost - prev.cost : 0;
                          return (
                            <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-white/5 last:border-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-slate-500">{entry.date}</span>
                                {entry.note && <span className="text-slate-400">{entry.note}</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-white">${entry.cost.toFixed(2)}</span>
                                {diff !== 0 && (
                                  <span className={`text-[10px] ${diff > 0 ? "text-red-400" : "text-green-400"}`}>
                                    {diff > 0 ? "+" : ""}{diff.toFixed(2)}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : tab === "priceChanges" ? (
        /* ============================================================ */
        /* PRICE CHANGES VIEW */
        /* ============================================================ */
        <div>
          {priceChanges.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
              Aucun historique de prix enregistr&eacute;.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-slate-900/60">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Produit</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Fournisseur</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Premier prix</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Prix actuel</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">&Eacute;volution</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Changements</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">P&eacute;riode</th>
                  </tr>
                </thead>
                <tbody>
                  {priceChanges.map((pc, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{pc.productName}</div>
                        <div className="text-[10px] text-slate-500">{pc.sku}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{pc.supplier}</td>
                      <td className="px-4 py-3 text-right text-slate-400">${pc.firstCost.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-medium text-white">${pc.currentCost.toFixed(2)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${pc.changePercent > 0 ? "text-red-400" : pc.changePercent < 0 ? "text-green-400" : "text-slate-500"}`}>
                        {pc.changePercent > 0 ? "↑" : pc.changePercent < 0 ? "↓" : "="} {Math.abs(pc.changePercent).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right text-slate-400">{pc.totalChanges}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{pc.firstDate} → {pc.lastDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* ============================================================ */
        /* SUPPLIERS LIST VIEW */
        /* ============================================================ */
        <div>
          {suppliers.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-8 text-center text-slate-400">
              Aucun fournisseur.
              {isAdmin && (
                <div className="mt-2">
                  <button type="button" onClick={openCreate} className="text-brand-400 hover:text-brand-300">+ Ajouter un fournisseur</button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {suppliers.map((supplier) => (
                <button
                  key={supplier.id}
                  type="button"
                  onClick={() => { setSelectedSupplier(supplier); fetchSupplierDetail(supplier.id); }}
                  className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 text-left transition hover:border-white/20 hover:bg-slate-900/60"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-white">{supplier.name}</div>
                      {supplier.contact && <div className="text-xs text-slate-400 mt-0.5">{supplier.contact}</div>}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${supplier.active ? "bg-green-500/20 text-green-400" : "bg-slate-500/20 text-slate-400"}`}>
                      {supplier.active ? "Actif" : "Inactif"}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                    <span>{supplier.products.length} produit{supplier.products.length !== 1 ? "s" : ""}</span>
                    {supplier.email && <span>{supplier.email}</span>}
                    {supplier.phone && <span>{supplier.phone}</span>}
                  </div>
                  {supplier.products.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {supplier.products.slice(0, 4).map((p) => (
                        <span key={p.catalogProductId} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                          {p.productName}
                        </span>
                      ))}
                      {supplier.products.length > 4 && (
                        <span className="text-[10px] text-slate-500">+{supplier.products.length - 4}</span>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* MODALS */}
      {/* ============================================================ */}

      {/* Supplier form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-medium text-white mb-4">
              {editingSupplier ? `Modifier: ${editingSupplier.name}` : "Nouveau fournisseur"}
            </h3>
            <div className="grid gap-3">
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Nom *</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <label className="text-xs text-slate-400">Personne contact</label>
                  <input value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
                    className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-slate-400">T&eacute;l&eacute;phone</label>
                  <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
                </div>
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Adresse</label>
                <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Site web</label>
                <input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                  className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                  placeholder="https://..." />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Notes</label>
                <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  className="rounded border-white/20" />
                Fournisseur actif
              </label>
            </div>
            {formError && <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{formError}</div>}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={handleSave} disabled={saving || !form.name}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50">
                {saving ? "Enregistrement..." : editingSupplier ? "Enregistrer" : "Cr\u00e9er"}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/10">Annuler</button>
              {editingSupplier && isAdmin && (
                <button type="button" onClick={() => { setShowForm(false); handleDelete(editingSupplier); }}
                  className="rounded-lg border border-red-500/20 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10">Supprimer</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add product modal */}
      {showAddProduct && selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[80vh] rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl flex flex-col">
            <h3 className="text-lg font-medium text-white mb-4">Ajouter un produit &agrave; {selectedSupplier.name}</h3>

            {!selectedCatalogProduct ? (
              <>
                <input type="text" placeholder="Rechercher un produit du catalogue..."
                  value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)}
                  className="mb-3 h-9 w-full rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500 placeholder:text-slate-500" />
                <div className="flex-1 overflow-y-auto">
                  <div className="grid gap-2">
                    {catalogProducts
                      .filter((cp) => {
                        if (!catalogSearch) return true;
                        const q = catalogSearch.toLowerCase();
                        return cp.name.toLowerCase().includes(q) || cp.sku.toLowerCase().includes(q);
                      })
                      .map((cp) => (
                        <button key={cp.id} type="button" onClick={() => { setSelectedCatalogProduct(cp); setAddCost(cp.cost || 0); }}
                          className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-800/40 p-3 text-left transition hover:border-white/20 hover:bg-slate-800/60">
                          <div>
                            <div className="font-medium text-white text-sm">{cp.name}</div>
                            <div className="text-[10px] text-slate-400">{cp.sku} {cp.brand && `\u2022 ${cp.brand}`}</div>
                          </div>
                          <div className="text-sm text-slate-400">${cp.cost.toFixed(2)}</div>
                        </button>
                      ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="grid gap-3">
                <div className="rounded-lg bg-slate-800/40 px-4 py-3">
                  <div className="font-medium text-white">{selectedCatalogProduct.name}</div>
                  <div className="text-xs text-slate-400">{selectedCatalogProduct.sku}</div>
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-slate-400">Prix co&ucirc;tant chez ce fournisseur ($)</label>
                  <input type="number" step="0.01" value={addCost}
                    onChange={(e) => setAddCost(parseFloat(e.target.value) || 0)}
                    className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-slate-400">Note (optionnel)</label>
                  <input value={addNote} onChange={(e) => setAddNote(e.target.value)}
                    className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                    placeholder="Prix initial, contrat, etc." />
                </div>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              {selectedCatalogProduct && (
                <>
                  <button type="button" onClick={handleAddProduct}
                    className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700">
                    Ajouter
                  </button>
                  <button type="button" onClick={() => setSelectedCatalogProduct(null)}
                    className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/10">Retour</button>
                </>
              )}
              <button type="button" onClick={() => setShowAddProduct(false)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/10">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* Update cost modal */}
      {costUpdate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-medium text-white mb-1">Mettre &agrave; jour le prix</h3>
            <p className="text-sm text-slate-400 mb-4">{costUpdate.product.productName}</p>
            <div className="grid gap-3">
              <div className="rounded-lg bg-slate-800/40 px-3 py-2 text-xs text-slate-400">
                Prix actuel: <span className="font-semibold text-white">${costUpdate.product.currentCost.toFixed(2)}</span>
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Nouveau prix ($)</label>
                <input type="number" step="0.01" value={newCost}
                  onChange={(e) => setNewCost(parseFloat(e.target.value) || 0)}
                  className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
                {newCost !== costUpdate.product.currentCost && newCost > 0 && (
                  <div className={`text-xs ${newCost > costUpdate.product.currentCost ? "text-red-400" : "text-green-400"}`}>
                    {newCost > costUpdate.product.currentCost ? "↑" : "↓"} {Math.abs(((newCost - costUpdate.product.currentCost) / costUpdate.product.currentCost) * 100).toFixed(1)}%
                    ({newCost > costUpdate.product.currentCost ? "+" : ""}{(newCost - costUpdate.product.currentCost).toFixed(2)})
                  </div>
                )}
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-slate-400">Raison / Note</label>
                <input value={costNote} onChange={(e) => setCostNote(e.target.value)}
                  className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                  placeholder="Augmentation fournisseur, nouveau contrat..." />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={handleUpdateCost}
                disabled={newCost === costUpdate.product.currentCost || newCost <= 0}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50">
                Enregistrer
              </button>
              <button type="button" onClick={() => setCostUpdate(null)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/10">Annuler</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
