"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

type Nutrition = {
  calories: number;
  fat: string;
  sugar: string;
  protein: string;
};

type Product = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  imageId: string;
  description: string;
  location: string;
  order: number;
  useRelay?: boolean;
  visible?: boolean;
  nutrition?: Nutrition;
};

type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  price: number;
  cost: number;
  imageId: string;
  warehouseStock: number;
  active: boolean;
};

type MachineInfo = {
  id: string;
  name?: string;
  status?: string;
  uptime?: string;
  lastSeen?: string;
  firmware?: string;
  agentVersion?: string;
  sensors?: { temp?: number; doorOpen?: boolean };
  meta?: {
    ip?: string;
    publicIp?: string;
    hostname?: string;
    services?: Record<string, string>;
    disk?: { percent?: number; used_gb?: number; total_gb?: number };
    memory?: { percent?: number; used_mb?: number; total_mb?: number };
    nayax?: {
      connected?: boolean;
      simulation?: boolean;
      state?: string;
      link?: { poll_count?: number; link_ready?: boolean; comm_errors?: number; crc_errors?: number };
    };
  };
};

const emptyProduct: Omit<Product, "id"> = {
  name: "",
  price: 0,
  quantity: 0,
  imageId: "",
  description: "",
  location: "",
  order: 999,
  useRelay: false,
  visible: true,
  nutrition: { calories: 0, fat: "", sugar: "", protein: "" },
};

export function MachineDetailClient({ machineId, isAdmin }: { machineId: string; isAdmin: boolean }) {
  const [machine, setMachine] = useState<MachineInfo | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Edit/Create state
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Omit<Product, "id">>(emptyProduct);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState<string | null>(null);
  const formImageRef = useRef<HTMLInputElement>(null);
  const [formImageFile, setFormImageFile] = useState<File | null>(null);
  const [formImagePreview, setFormImagePreview] = useState<string | null>(null);

  // Catalog picker state
  const [showCatalogPicker, setShowCatalogPicker] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);

  const apiBase = `/api/machines/${machineId}/products`;

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [machineRes, productsRes] = await Promise.all([
        fetch(`/api/machines?v=${Date.now()}`, { cache: "no-store" }),
        fetch(`${apiBase}?v=${Date.now()}`, { cache: "no-store" }),
      ]);

      if (machineRes.ok) {
        const machines = await machineRes.json();
        const m = Array.isArray(machines) ? machines.find((x: any) => x.id === machineId) : null;
        setMachine(m || { id: machineId });
      }

      if (productsRes.ok) {
        const data = await productsRes.json();
        setProducts((data.products || []).sort((a: Product, b: Product) => (a.order ?? 0) - (b.order ?? 0)));
      }
    } catch (e: any) {
      setError(e.message || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, []);

  const openCreate = () => {
    const maxOrder = products.reduce((max, p) => Math.max(max, p.order || 0), -1) + 1;
    setForm({ ...emptyProduct, order: maxOrder });
    setCreating(true);
    setEditing(null);
    setFormError(null);
    setFormImageFile(null);
    setFormImagePreview(null);
  };

  const openCatalogPicker = async () => {
    setShowCatalogPicker(true);
    setCatalogSearch("");
    setCatalogLoading(true);
    try {
      const res = await fetch(`/api/products?activeOnly=true&v=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setCatalogProducts(data.products || []);
      }
    } catch {} finally {
      setCatalogLoading(false);
    }
  };

  const addFromCatalog = (cp: CatalogProduct) => {
    const maxOrder = products.reduce((max, p) => Math.max(max, p.order || 0), -1) + 1;
    setForm({
      name: cp.name,
      price: cp.price,
      quantity: 0,
      imageId: cp.imageId || "",
      description: cp.description || "",
      location: "",
      order: maxOrder,
      useRelay: false,
      visible: true,
      nutrition: undefined,
    });
    setCreating(true);
    setEditing(null);
    setFormError(null);
    setFormImageFile(null);
    setFormImagePreview(cp.id ? `/api/products/${cp.id}/image?v=${Date.now()}` : null);
    setShowCatalogPicker(false);
  };

  const openEdit = (product: Product) => {
    setForm({
      name: product.name,
      price: product.price,
      quantity: product.quantity,
      imageId: product.imageId,
      description: product.description,
      location: product.location,
      order: product.order,
      useRelay: product.useRelay ?? false,
      visible: product.visible !== false,
      nutrition: product.nutrition || { calories: 0, fat: "", sugar: "", protein: "" },
    });
    setEditing(product);
    setCreating(false);
    setFormError(null);
    setFormImageFile(null);
    setFormImagePreview(`/api/machines/${machineId}/products/${product.id}/image?v=${Date.now()}`);
  };

  const closeForm = () => {
    setEditing(null);
    setCreating(false);
    setFormError(null);
    setFormImageFile(null);
    setFormImagePreview(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setFormError(null);
    try {
      let savedProductId: string | null = null;
      if (creating) {
        const res = await fetch(apiBase, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        savedProductId = data.product?.id || null;
      } else if (editing) {
        const res = await fetch(apiBase, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: editing.id, ...form }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        savedProductId = editing.id;
      }

      // Upload image if a file was selected
      if (formImageFile && savedProductId) {
        const fd = new FormData();
        fd.append("image", formImageFile);
        const imgRes = await fetch(`/api/machines/${machineId}/products/${savedProductId}/image`, {
          method: "POST",
          body: fd,
        });
        const imgData = await imgRes.json();
        if (!imgData.ok) console.warn("Image upload warning:", imgData.error);
      }

      closeForm();
      await fetchData();
    } catch (e: any) {
      setFormError(e.message || "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product: Product) => {
    if (!window.confirm(`Supprimer "${product.name}" ?`)) return;
    try {
      const res = await fetch(`${apiBase}?productId=${product.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await fetchData();
    } catch (e: any) {
      alert(e.message || "Erreur");
    }
  };

  const handleToggleVisible = async (product: Product) => {
    try {
      const res = await fetch(apiBase, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, visible: !product.visible }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await fetchData();
    } catch (e: any) {
      alert(e.message || "Erreur");
    }
  };

  const handleImageUpload = async (productId: string, file: File) => {
    setUploadingImage(productId);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(`/api/machines/${machineId}/products/${productId}/image`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await fetchData();
    } catch (e: any) {
      alert(e.message || "Erreur upload");
    } finally {
      setUploadingImage(null);
    }
  };

  const handleSyncToMachine = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const visibleProducts = products.filter((p) => p.visible !== false);

      // Fetch images as base64 to include in sync
      const productsWithImages = await Promise.all(
        visibleProducts.map(async (p) => {
          try {
            const imgRes = await fetch(`/api/machines/${machineId}/products/${p.id}/image?v=${Date.now()}`);
            const ct = imgRes.headers.get("content-type") || "";
            if (imgRes.ok && ct.startsWith("image/") && !ct.includes("svg")) {
              const blob = await imgRes.blob();
              const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
              return { ...p, _imageBase64: base64 };
            }
          } catch { /* ignore */ }
          return p;
        })
      );

      const res = await fetch(`/api/machines/${machineId}/sync-products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: productsWithImages }),
      });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        throw new Error(`Serveur a répondu ${res.status} (payload trop gros ?)`);
      }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Sync failed");
      const transport = data.transport === "websocket" ? " (WebSocket instant)" : " (en attente ~30s)";
      setSyncMsg(`Synchronisé: ${visibleProducts.length} produits envoyés${transport}`);
    } catch (e: any) {
      setSyncMsg(`Erreur: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const updateField = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateNutrition = (field: string, value: any) => {
    setForm((prev) => ({
      ...prev,
      nutrition: { ...prev.nutrition!, [field]: value },
    }));
  };

  if (loading) {
    return <div className="text-slate-400 text-sm">Chargement...</div>;
  }

  const isFormOpen = creating || editing !== null;

  return (
    <>
      {/* Breadcrumb + machine info */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-slate-400 mb-2">
          <Link href="/machines" className="hover:text-white">Machines</Link>
          <span>/</span>
          <span className="text-white">{machine?.name || machineId}</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">{machine?.name || machineId}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="font-mono">{machineId}</span>
              {machine?.meta?.ip && <span>IP: <span className="font-mono text-white">{machine.meta.ip}</span></span>}
              {machine?.status && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${machine.status === "online" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                  {machine.status === "online" ? "En ligne" : "Hors ligne"}
                </span>
              )}
              {machine?.uptime && <span>Uptime: {machine.uptime}</span>}
              {machine?.meta?.nayax && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  machine.meta.nayax.simulation
                    ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/20"
                    : machine.meta.nayax.connected && machine.meta.nayax.link?.link_ready
                      ? "bg-green-500/20 text-green-300 border border-green-500/20"
                      : "bg-red-500/20 text-red-300 border border-red-500/20"
                }`}>
                  Nayax: {machine.meta.nayax.simulation ? "SIM" : machine.meta.nayax.connected && machine.meta.nayax.link?.link_ready ? "LIVE" : "OFF"}
                </span>
              )}
            </div>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSyncToMachine}
                disabled={syncing || products.length === 0}
                className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-300 transition hover:bg-blue-500/20 disabled:opacity-50"
              >
                {syncing ? "Sync..." : "Synchroniser vers machine"}
              </button>
              <button
                type="button"
                onClick={openCatalogPicker}
                className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-4 py-2 text-sm font-medium text-brand-300 transition hover:bg-brand-500/20"
              >
                + Depuis le catalogue
              </button>
              <button
                type="button"
                onClick={openCreate}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
              >
                + Nouveau produit
              </button>
            </div>
          )}
        </div>
        {syncMsg && (
          <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${syncMsg.startsWith("Erreur") ? "bg-red-500/10 text-red-300 border border-red-500/20" : "bg-green-500/10 text-green-300 border border-green-500/20"}`}>
            {syncMsg}
          </div>
        )}
      </div>

      {/* Catalog picker modal */}
      {showCatalogPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[80vh] rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-white">Ajouter depuis le catalogue</h3>
              <button type="button" onClick={() => setShowCatalogPicker(false)}
                className="rounded-md border border-white/10 px-3 py-1 text-sm text-white hover:bg-white/10">Fermer</button>
            </div>
            <input
              type="text"
              placeholder="Rechercher un produit..."
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              className="mb-3 h-9 w-full rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500 placeholder:text-slate-500"
            />
            <div className="flex-1 overflow-y-auto">
              {catalogLoading ? (
                <div className="text-sm text-slate-400 text-center py-8">Chargement...</div>
              ) : catalogProducts.filter((cp) => {
                if (!catalogSearch) return true;
                const q = catalogSearch.toLowerCase();
                return cp.name.toLowerCase().includes(q) || cp.sku.toLowerCase().includes(q) || cp.brand.toLowerCase().includes(q);
              }).length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-8">Aucun produit dans le catalogue.</div>
              ) : (
                <div className="grid gap-2">
                  {catalogProducts
                    .filter((cp) => {
                      if (!catalogSearch) return true;
                      const q = catalogSearch.toLowerCase();
                      return cp.name.toLowerCase().includes(q) || cp.sku.toLowerCase().includes(q) || cp.brand.toLowerCase().includes(q);
                    })
                    .map((cp) => (
                      <button
                        key={cp.id}
                        type="button"
                        onClick={() => addFromCatalog(cp)}
                        className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-800/40 p-3 text-left transition hover:border-white/20 hover:bg-slate-800/60"
                      >
                        <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-slate-700/40 overflow-hidden">
                          <img src={`/api/products/${cp.id}/image?v=1`} alt={cp.name}
                            className="h-full w-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white text-sm truncate">{cp.name}</div>
                          <div className="text-[10px] text-slate-400">
                            {cp.sku} {cp.brand && `• ${cp.brand}`} {cp.category && `• ${cp.category}`}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-semibold text-green-400">${cp.price.toFixed(2)}</div>
                          <div className="text-[10px] text-slate-500">Entrepôt: {cp.warehouseStock}</div>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {/* Product form (create/edit) */}
      {isFormOpen && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-slate-900/60 p-6">
          <h2 className="text-lg font-medium text-white mb-4">
            {creating ? "Nouveau produit" : `Modifier: ${editing?.name}`}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Nom *</label>
              <input value={form.name} onChange={(e) => updateField("name", e.target.value)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Prix ($) *</label>
              <input type="number" step="0.01" value={form.price} onChange={(e) => updateField("price", parseFloat(e.target.value) || 0)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Quantité</label>
              <input type="number" value={form.quantity} onChange={(e) => updateField("quantity", parseInt(e.target.value) || 0)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Emplacement (ex: A1, 32)</label>
              <input value={form.location} onChange={(e) => updateField("location", e.target.value)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                placeholder="A1, A2, 32..." />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Ordre d&apos;affichage</label>
              <input type="number" value={form.order} onChange={(e) => updateField("order", parseInt(e.target.value) || 0)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Image du produit</label>
              <div className="flex items-center gap-3">
                {/* Preview */}
                <div className="h-16 w-16 flex-shrink-0 rounded-lg bg-slate-800/60 overflow-hidden border border-white/10">
                  {formImagePreview ? (
                    <img
                      src={formImageFile ? formImagePreview : formImagePreview}
                      alt="Preview"
                      className="h-full w-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">Aucune</div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => formImageRef.current?.click()}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10 transition"
                  >
                    {formImageFile ? "Changer l\u2019image" : "Choisir une image"}
                  </button>
                  {formImageFile && (
                    <span className="text-[10px] text-slate-400 truncate max-w-[140px]">{formImageFile.name}</span>
                  )}
                  <input
                    ref={formImageRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setFormImageFile(file);
                        const url = URL.createObjectURL(file);
                        setFormImagePreview(url);
                        // Auto-set imageId from filename (without extension)
                        const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[\s_]+/g, "-").toLowerCase();
                        updateField("imageId", baseName);
                      }
                    }}
                  />
                </div>
              </div>
              {/* Keep imageId as hidden/small field for advanced users */}
              <input value={form.imageId} onChange={(e) => updateField("imageId", e.target.value)}
                className="mt-1 h-8 rounded-md bg-slate-950/50 px-2 text-[11px] text-slate-400 outline-none ring-1 ring-white/5 focus:ring-white/10"
                placeholder="image-id (auto)" />
            </div>
            <div className="md:col-span-3 grid gap-1">
              <label className="text-xs text-slate-400">Description</label>
              <input value={form.description} onChange={(e) => updateField("description", e.target.value)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
            </div>

            {/* Nutrition */}
            <div className="md:col-span-3">
              <div className="text-xs text-slate-400 mb-2">Informations nutritives</div>
              <div className="grid grid-cols-4 gap-3">
                <div className="grid gap-1">
                  <label className="text-[10px] text-slate-500">Calories</label>
                  <input type="number" value={form.nutrition?.calories || 0} onChange={(e) => updateNutrition("calories", parseInt(e.target.value) || 0)}
                    className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
                </div>
                <div className="grid gap-1">
                  <label className="text-[10px] text-slate-500">Protéines</label>
                  <input value={form.nutrition?.protein || ""} onChange={(e) => updateNutrition("protein", e.target.value)}
                    className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" placeholder="20g" />
                </div>
                <div className="grid gap-1">
                  <label className="text-[10px] text-slate-500">Gras</label>
                  <input value={form.nutrition?.fat || ""} onChange={(e) => updateNutrition("fat", e.target.value)}
                    className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" placeholder="5g" />
                </div>
                <div className="grid gap-1">
                  <label className="text-[10px] text-slate-500">Sucre</label>
                  <input value={form.nutrition?.sugar || ""} onChange={(e) => updateNutrition("sugar", e.target.value)}
                    className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" placeholder="5g" />
                </div>
              </div>
            </div>

            {/* Toggles */}
            <div className="md:col-span-3 flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={form.visible !== false} onChange={(e) => updateField("visible", e.target.checked)}
                  className="rounded border-white/20" />
                Visible au client
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={form.useRelay ?? false} onChange={(e) => updateField("useRelay", e.target.checked)}
                  className="rounded border-white/20" />
                Utiliser relay GPIO (au lieu du clavier)
              </label>
            </div>
          </div>

          {formError && (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{formError}</div>
          )}

          <div className="mt-4 flex gap-2">
            <button type="button" onClick={handleSave} disabled={saving || !form.name}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50">
              {saving ? "Enregistrement..." : creating ? "Créer" : "Enregistrer"}
            </button>
            <button type="button" onClick={closeForm}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Products grid */}
      {products.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-8 text-center text-slate-400">
          Aucun produit configuré pour cette machine.
          {isAdmin && (
            <div className="mt-2">
              <button type="button" onClick={openCreate} className="text-brand-400 hover:text-brand-300">
                + Ajouter un produit
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((product) => (
            <div
              key={product.id}
              className={`rounded-2xl border p-4 transition ${
                product.visible !== false
                  ? "border-white/10 bg-slate-900/40 hover:border-white/20"
                  : "border-white/5 bg-slate-900/20 opacity-60"
              }`}
            >
              {/* Product image */}
              <div className="relative mb-3">
                <img
                  src={`/api/machines/${machineId}/products/${product.id}/image?v=${Date.now()}`}
                  alt={product.name}
                  className="h-32 w-full rounded-lg object-cover bg-slate-800/40"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `data:image/svg+xml,${encodeURIComponent('<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg"><rect fill="#1e293b" width="200" height="200" rx="12"/><text fill="#475569" font-family="sans-serif" font-size="14" x="50%" y="50%" text-anchor="middle" dy=".3em">Pas d\'image</text></svg>')}`;
                  }}
                />
                {product.visible === false && (
                  <div className="absolute top-2 left-2 rounded bg-red-500/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    MASQUÉ
                  </div>
                )}
                {product.useRelay && (
                  <div className="absolute top-2 right-2 rounded bg-purple-500/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    RELAY
                  </div>
                )}
                {isAdmin && (
                  <label className="absolute bottom-2 right-2 cursor-pointer rounded bg-white/10 px-2 py-1 text-[10px] text-white backdrop-blur hover:bg-white/20">
                    {uploadingImage === product.id ? "..." : "Photo"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageUpload(product.id, file);
                      }}
                    />
                  </label>
                )}
              </div>

              {/* Product info */}
              <div className="mb-2">
                <h3 className="font-medium text-white text-sm truncate">{product.name}</h3>
                {product.description && (
                  <p className="text-xs text-slate-400 truncate mt-0.5">{product.description}</p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                <div>
                  <span className="text-slate-500">Prix</span>
                  <div className="font-semibold text-green-400">${product.price.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-slate-500">Qté</span>
                  <div className="font-semibold text-white">{product.quantity}</div>
                </div>
                <div>
                  <span className="text-slate-500">Position</span>
                  <div className="font-mono font-semibold text-white">{product.location || "—"}</div>
                </div>
              </div>

              {/* Nutrition */}
              {product.nutrition && (
                <div className="rounded-lg bg-slate-800/40 p-2 text-[10px] text-slate-400 mb-3">
                  <div className="grid grid-cols-4 gap-1 text-center">
                    <div><div className="font-medium text-white">{product.nutrition.calories}</div>cal</div>
                    <div><div className="font-medium text-white">{product.nutrition.protein}</div>prot</div>
                    <div><div className="font-medium text-white">{product.nutrition.fat}</div>gras</div>
                    <div><div className="font-medium text-white">{product.nutrition.sugar}</div>sucre</div>
                  </div>
                </div>
              )}

              {/* Actions */}
              {isAdmin && (
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => openEdit(product)}
                    className="flex-1 rounded-md border border-white/10 py-1.5 text-xs text-white hover:bg-white/10">
                    Modifier
                  </button>
                  <button type="button" onClick={() => handleToggleVisible(product)}
                    className="rounded-md border border-white/10 px-2 py-1.5 text-xs text-white hover:bg-white/10"
                    title={product.visible !== false ? "Masquer" : "Rendre visible"}>
                    {product.visible !== false ? "👁" : "👁‍🗨"}
                  </button>
                  <button type="button" onClick={() => handleDelete(product)}
                    className="rounded-md border border-red-500/20 px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/10">
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
