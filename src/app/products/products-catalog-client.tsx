"use client";

import { useEffect, useState, useRef } from "react";

type Nutrition = {
  calories: number;
  fat: string;
  sugar: string;
  protein: string;
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
  nutrition?: Nutrition;
  warehouseStock: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const emptyForm: Omit<CatalogProduct, "id" | "createdAt" | "updatedAt"> = {
  sku: "",
  name: "",
  brand: "",
  category: "",
  description: "",
  price: 0,
  cost: 0,
  imageId: "",
  nutrition: { calories: 0, fat: "", sugar: "", protein: "" },
  warehouseStock: 0,
  active: true,
};

export function ProductsCatalogClient({ isAdmin }: { isAdmin: boolean }) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");

  // Form state
  const [editing, setEditing] = useState<CatalogProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const formImageRef = useRef<HTMLInputElement>(null);
  const [formImageFile, setFormImageFile] = useState<File | null>(null);
  const [formImagePreview, setFormImagePreview] = useState<string | null>(null);

  // Stock adjustment
  const [stockAdjust, setStockAdjust] = useState<{ id: string; name: string } | null>(null);
  const [stockDelta, setStockDelta] = useState(0);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Erreur chargement");
      const data = await res.json();
      setProducts(data.products || []);
      setCategories(data.categories || []);
    } catch (e: any) {
      setError(e.message || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(); }, []);

  // Filtered products
  const filtered = products.filter((p) => {
    if (filterCategory && p.category !== filterCategory) return false;
    if (filterActive === "active" && !p.active) return false;
    if (filterActive === "inactive" && p.active) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Stats
  const totalProducts = products.length;
  const activeProducts = products.filter((p) => p.active).length;
  const totalWarehouseStock = products.reduce((sum, p) => sum + p.warehouseStock, 0);
  const totalValue = products.reduce((sum, p) => sum + p.warehouseStock * p.cost, 0);
  const lowStockProducts = products.filter((p) => p.active && p.warehouseStock <= 5);

  const openCreate = () => {
    setForm({ ...emptyForm });
    setCreating(true);
    setEditing(null);
    setFormError(null);
    setFormImageFile(null);
    setFormImagePreview(null);
  };

  const openEdit = (product: CatalogProduct) => {
    setForm({
      sku: product.sku,
      name: product.name,
      brand: product.brand,
      category: product.category,
      description: product.description,
      price: product.price,
      cost: product.cost,
      imageId: product.imageId,
      nutrition: product.nutrition || { calories: 0, fat: "", sugar: "", protein: "" },
      warehouseStock: product.warehouseStock,
      active: product.active,
    });
    setEditing(product);
    setCreating(false);
    setFormError(null);
    setFormImageFile(null);
    setFormImagePreview(`/api/products/${product.id}/image?v=${Date.now()}`);
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
      let savedId: string | null = null;

      if (creating) {
        const res = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        savedId = data.product?.id || null;
      } else if (editing) {
        const res = await fetch("/api/products", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editing.id, ...form }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        savedId = editing.id;
      }

      // Upload image if selected
      if (formImageFile && savedId) {
        const fd = new FormData();
        fd.append("image", formImageFile);
        await fetch(`/api/products/${savedId}/image`, { method: "POST", body: fd });
      }

      closeForm();
      await fetchData();
    } catch (e: any) {
      setFormError(e.message || "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product: CatalogProduct) => {
    if (!window.confirm(`Supprimer "${product.name}" (${product.sku}) du catalogue ?`)) return;
    try {
      const res = await fetch(`/api/products?id=${product.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await fetchData();
    } catch (e: any) {
      alert(e.message || "Erreur");
    }
  };

  const handleToggleActive = async (product: CatalogProduct) => {
    try {
      const res = await fetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: product.id, active: !product.active }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await fetchData();
    } catch (e: any) {
      alert(e.message || "Erreur");
    }
  };

  const handleStockAdjust = async () => {
    if (!stockAdjust || stockDelta === 0) return;
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustStock: true, id: stockAdjust.id, delta: stockDelta }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setStockAdjust(null);
      setStockDelta(0);
      await fetchData();
    } catch (e: any) {
      alert(e.message || "Erreur");
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
    return <div className="text-slate-400 text-sm">Chargement du catalogue...</div>;
  }

  const isFormOpen = creating || editing !== null;

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Catalogue Produits</h1>
            <p className="mt-1 text-sm text-slate-400">
              Tous les produits disponibles pour les machines Shaka.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
            >
              + Nouveau produit
            </button>
          )}
        </div>
      </div>

      {/* Stats cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">Produits</div>
          <div className="mt-1 text-2xl font-semibold text-white">{totalProducts}</div>
          <div className="text-[10px] text-slate-500">{activeProducts} actifs</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">Cat&eacute;gories</div>
          <div className="mt-1 text-2xl font-semibold text-white">{categories.length}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">Stock entrep&ocirc;t</div>
          <div className="mt-1 text-2xl font-semibold text-white">{totalWarehouseStock}</div>
          <div className="text-[10px] text-slate-500">unit&eacute;s totales</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">Valeur stock</div>
          <div className="mt-1 text-2xl font-semibold text-green-400">${totalValue.toFixed(2)}</div>
          <div className="text-[10px] text-slate-500">au prix co&ucirc;tant</div>
        </div>
        <div className={`rounded-xl border p-4 ${lowStockProducts.length > 0 ? "border-orange-500/30 bg-orange-500/10" : "border-white/10 bg-slate-900/40"}`}>
          <div className="text-xs text-slate-400">Stock bas</div>
          <div className={`mt-1 text-2xl font-semibold ${lowStockProducts.length > 0 ? "text-orange-400" : "text-white"}`}>
            {lowStockProducts.length}
          </div>
          <div className="text-[10px] text-slate-500">&le; 5 unit&eacute;s</div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Rechercher (nom, SKU, marque)..."
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          className="h-9 w-64 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500 placeholder:text-slate-500"
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Toutes cat&eacute;gories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value as any)}
          className="h-9 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">Tous</option>
          <option value="active">Actifs</option>
          <option value="inactive">Inactifs</option>
        </select>
        <span className="text-xs text-slate-500">{filtered.length} produit{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {/* Stock adjustment modal */}
      {stockAdjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-medium text-white mb-1">Ajuster le stock</h3>
            <p className="text-sm text-slate-400 mb-4">{stockAdjust.name}</p>
            <div className="flex items-center gap-3 mb-4">
              <button
                type="button"
                onClick={() => setStockDelta((d) => d - 1)}
                className="h-10 w-10 rounded-lg border border-white/10 bg-white/5 text-lg text-white hover:bg-white/10"
              >
                -
              </button>
              <input
                type="number"
                value={stockDelta}
                onChange={(e) => setStockDelta(parseInt(e.target.value) || 0)}
                className="h-10 w-24 rounded-lg bg-slate-950/50 px-3 text-center text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={() => setStockDelta((d) => d + 1)}
                className="h-10 w-10 rounded-lg border border-white/10 bg-white/5 text-lg text-white hover:bg-white/10"
              >
                +
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleStockAdjust}
                disabled={stockDelta === 0}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${
                  stockDelta > 0 ? "bg-green-600 hover:bg-green-700" : stockDelta < 0 ? "bg-red-600 hover:bg-red-700" : "bg-slate-600"
                }`}
              >
                {stockDelta > 0 ? `+ ${stockDelta} unit\u00e9s` : stockDelta < 0 ? `${stockDelta} unit\u00e9s` : "Aucun changement"}
              </button>
              <button
                type="button"
                onClick={() => { setStockAdjust(null); setStockDelta(0); }}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/10"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product form (create/edit) */}
      {isFormOpen && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-slate-900/60 p-6">
          <h2 className="text-lg font-medium text-white mb-4">
            {creating ? "Nouveau produit au catalogue" : `Modifier: ${editing?.name}`}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">SKU *</label>
              <input value={form.sku} onChange={(e) => updateField("sku", e.target.value)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                placeholder="SHAKA-PROT-001" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Nom *</label>
              <input value={form.name} onChange={(e) => updateField("name", e.target.value)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Marque</label>
              <input value={form.brand} onChange={(e) => updateField("brand", e.target.value)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Cat&eacute;gorie</label>
              <input value={form.category} onChange={(e) => updateField("category", e.target.value)}
                list="categories-list"
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500"
                placeholder="Boisson, Snack, Prot\u00e9ine..." />
              <datalist id="categories-list">
                {categories.map((cat) => <option key={cat} value={cat} />)}
              </datalist>
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Prix de vente ($)</label>
              <input type="number" step="0.01" value={form.price} onChange={(e) => updateField("price", parseFloat(e.target.value) || 0)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Prix co&ucirc;tant ($)</label>
              <input type="number" step="0.01" value={form.cost} onChange={(e) => updateField("cost", parseFloat(e.target.value) || 0)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Stock entrep&ocirc;t</label>
              <input type="number" value={form.warehouseStock} onChange={(e) => updateField("warehouseStock", parseInt(e.target.value) || 0)}
                className="h-10 rounded-lg bg-slate-950/50 px-3 text-sm text-slate-100 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-slate-400">Image</label>
              <div className="flex items-center gap-3">
                <div className="h-16 w-16 flex-shrink-0 rounded-lg bg-slate-800/60 overflow-hidden border border-white/10">
                  {formImagePreview ? (
                    <img src={formImagePreview} alt="Preview" className="h-full w-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">Aucune</div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <button type="button" onClick={() => formImageRef.current?.click()}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10 transition">
                    {formImageFile ? "Changer" : "Choisir une image"}
                  </button>
                  {formImageFile && <span className="text-[10px] text-slate-400 truncate max-w-[140px]">{formImageFile.name}</span>}
                  <input ref={formImageRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setFormImageFile(file);
                        setFormImagePreview(URL.createObjectURL(file));
                      }
                    }} />
                </div>
              </div>
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
                  <label className="text-[10px] text-slate-500">Prot&eacute;ines</label>
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

            {/* Active toggle */}
            <div className="md:col-span-3">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={form.active !== false} onChange={(e) => updateField("active", e.target.checked)}
                  className="rounded border-white/20" />
                Produit actif (disponible pour les machines)
              </label>
            </div>
          </div>

          {formError && (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{formError}</div>
          )}

          <div className="mt-4 flex gap-2">
            <button type="button" onClick={handleSave} disabled={saving || !form.name || !form.sku}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50">
              {saving ? "Enregistrement..." : creating ? "Cr\u00e9er" : "Enregistrer"}
            </button>
            <button type="button" onClick={closeForm}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10">
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Products table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-slate-900/40 p-8 text-center text-slate-400">
          {products.length === 0 ? "Aucun produit dans le catalogue." : "Aucun produit ne correspond aux filtres."}
          {isAdmin && products.length === 0 && (
            <div className="mt-2">
              <button type="button" onClick={openCreate} className="text-brand-400 hover:text-brand-300">
                + Ajouter un produit
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-slate-900/60">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Produit</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">SKU</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Cat&eacute;gorie</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Prix</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Co&ucirc;t</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Marge</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Entrep&ocirc;t</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">Statut</th>
                {isAdmin && <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => {
                const margin = product.price > 0 && product.cost > 0
                  ? ((product.price - product.cost) / product.price * 100).toFixed(0)
                  : "—";
                const isLowStock = product.active && product.warehouseStock <= 5;

                return (
                  <tr
                    key={product.id}
                    className={`border-b border-white/5 transition hover:bg-white/5 ${!product.active ? "opacity-50" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 flex-shrink-0 rounded-lg bg-slate-800/60 overflow-hidden">
                          <img
                            src={`/api/products/${product.id}/image?v=${Date.now()}`}
                            alt={product.name}
                            className="h-full w-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>
                        <div>
                          <div className="font-medium text-white">{product.name}</div>
                          {product.brand && <div className="text-[10px] text-slate-500">{product.brand}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{product.sku}</td>
                    <td className="px-4 py-3">
                      {product.category ? (
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-300">{product.category}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-green-400">${product.price.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">${product.cost.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{margin}%</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => { setStockAdjust({ id: product.id, name: product.name }); setStockDelta(0); }}
                        className={`font-semibold ${isLowStock ? "text-orange-400" : "text-white"} hover:underline`}
                        title="Ajuster le stock"
                      >
                        {product.warehouseStock}
                      </button>
                      {isLowStock && <div className="text-[9px] text-orange-400">stock bas</div>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        product.active
                          ? "bg-green-500/20 text-green-400"
                          : "bg-slate-500/20 text-slate-400"
                      }`}>
                        {product.active ? "Actif" : "Inactif"}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => openEdit(product)}
                            className="rounded-md border border-white/10 px-2 py-1 text-xs text-white hover:bg-white/10">
                            Modifier
                          </button>
                          <button type="button" onClick={() => handleToggleActive(product)}
                            className="rounded-md border border-white/10 px-2 py-1 text-xs text-white hover:bg-white/10"
                            title={product.active ? "D\u00e9sactiver" : "Activer"}>
                            {product.active ? "Off" : "On"}
                          </button>
                          <button type="button" onClick={() => handleDelete(product)}
                            className="rounded-md border border-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10">
                            &#10005;
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
