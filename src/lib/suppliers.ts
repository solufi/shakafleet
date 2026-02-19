import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PriceHistoryEntry {
  date: string;        // YYYY-MM-DD
  cost: number;        // prix coûtant à cette date
  note?: string;       // ex: "Augmentation fournisseur", "Nouveau contrat"
}

export interface SupplierProduct {
  catalogProductId: string;   // lien vers CatalogProduct.id
  productName: string;        // dénormalisé pour affichage rapide
  sku: string;
  currentCost: number;
  priceHistory: PriceHistoryEntry[];
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;       // personne contact
  email: string;
  phone: string;
  address: string;
  website: string;
  notes: string;
  products: SupplierProduct[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
const DATA_DIR = process.env.USERS_DATA_DIR || path.join(process.cwd(), "data");
const SUPPLIERS_FILE = path.join(DATA_DIR, "suppliers.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readAll(): Supplier[] {
  ensureDir();
  if (!fs.existsSync(SUPPLIERS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SUPPLIERS_FILE, "utf-8")) as Supplier[];
  } catch {
    return [];
  }
}

let _cache: Supplier[] | null = null;

function getAll(): Supplier[] {
  if (!_cache) _cache = readAll();
  return _cache;
}

function persist(suppliers: Supplier[]) {
  ensureDir();
  _cache = suppliers;
  fs.writeFileSync(SUPPLIERS_FILE, JSON.stringify(suppliers, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
export function listSuppliers(opts?: { activeOnly?: boolean }): Supplier[] {
  let suppliers = getAll();
  if (opts?.activeOnly) {
    suppliers = suppliers.filter((s) => s.active);
  }
  return suppliers;
}

export function getSupplier(id: string): Supplier | undefined {
  return getAll().find((s) => s.id === id);
}

export function createSupplier(data: Omit<Supplier, "id" | "createdAt" | "updatedAt" | "products">): Supplier {
  const suppliers = getAll();
  const now = new Date().toISOString();
  const supplier: Supplier = {
    ...data,
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    products: [],
    createdAt: now,
    updatedAt: now,
  };
  persist([...suppliers, supplier]);
  console.log(`[suppliers] Created "${supplier.name}"`);
  return supplier;
}

export function updateSupplier(
  id: string,
  updates: Partial<Omit<Supplier, "id" | "createdAt" | "products">>
): Supplier {
  const suppliers = getAll();
  const idx = suppliers.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error("Fournisseur introuvable");

  const updated = { ...suppliers[idx], ...updates, updatedAt: new Date().toISOString() };
  const newList = [...suppliers];
  newList[idx] = updated;
  persist(newList);
  return updated;
}

export function deleteSupplier(id: string): void {
  const suppliers = getAll();
  const filtered = suppliers.filter((s) => s.id !== id);
  if (filtered.length === suppliers.length) throw new Error("Fournisseur introuvable");
  persist(filtered);
  console.log(`[suppliers] Deleted supplier ${id}`);
}

// ---------------------------------------------------------------------------
// Product-Supplier linking + Price history
// ---------------------------------------------------------------------------

export function addProductToSupplier(
  supplierId: string,
  product: { catalogProductId: string; productName: string; sku: string; cost: number; note?: string }
): Supplier {
  const suppliers = getAll();
  const idx = suppliers.findIndex((s) => s.id === supplierId);
  if (idx === -1) throw new Error("Fournisseur introuvable");

  const supplier = { ...suppliers[idx] };
  const existingIdx = supplier.products.findIndex((p) => p.catalogProductId === product.catalogProductId);

  const today = new Date().toISOString().slice(0, 10);

  if (existingIdx >= 0) {
    // Product already linked — update cost and add history entry
    const existing = { ...supplier.products[existingIdx] };
    if (existing.currentCost !== product.cost) {
      existing.priceHistory = [
        ...existing.priceHistory,
        { date: today, cost: product.cost, note: product.note || "Mise à jour du prix" },
      ];
      existing.currentCost = product.cost;
    }
    existing.productName = product.productName;
    existing.sku = product.sku;
    supplier.products = [...supplier.products];
    supplier.products[existingIdx] = existing;
  } else {
    // New product link
    supplier.products = [
      ...supplier.products,
      {
        catalogProductId: product.catalogProductId,
        productName: product.productName,
        sku: product.sku,
        currentCost: product.cost,
        priceHistory: [{ date: today, cost: product.cost, note: product.note || "Prix initial" }],
      },
    ];
  }

  supplier.updatedAt = new Date().toISOString();
  const newList = [...suppliers];
  newList[idx] = supplier;
  persist(newList);
  console.log(`[suppliers] Product "${product.productName}" linked to "${supplier.name}" at $${product.cost}`);
  return supplier;
}

export function removeProductFromSupplier(supplierId: string, catalogProductId: string): Supplier {
  const suppliers = getAll();
  const idx = suppliers.findIndex((s) => s.id === supplierId);
  if (idx === -1) throw new Error("Fournisseur introuvable");

  const supplier = { ...suppliers[idx] };
  supplier.products = supplier.products.filter((p) => p.catalogProductId !== catalogProductId);
  supplier.updatedAt = new Date().toISOString();

  const newList = [...suppliers];
  newList[idx] = supplier;
  persist(newList);
  return supplier;
}

export function updateProductCost(
  supplierId: string,
  catalogProductId: string,
  newCost: number,
  note?: string
): Supplier {
  const suppliers = getAll();
  const idx = suppliers.findIndex((s) => s.id === supplierId);
  if (idx === -1) throw new Error("Fournisseur introuvable");

  const supplier = { ...suppliers[idx] };
  const pIdx = supplier.products.findIndex((p) => p.catalogProductId === catalogProductId);
  if (pIdx === -1) throw new Error("Produit non lié à ce fournisseur");

  const product = { ...supplier.products[pIdx] };
  const today = new Date().toISOString().slice(0, 10);

  product.priceHistory = [
    ...product.priceHistory,
    { date: today, cost: newCost, note: note || `Prix mis à jour: $${product.currentCost} → $${newCost}` },
  ];
  product.currentCost = newCost;

  supplier.products = [...supplier.products];
  supplier.products[pIdx] = product;
  supplier.updatedAt = new Date().toISOString();

  const newList = [...suppliers];
  newList[idx] = supplier;
  persist(newList);
  console.log(`[suppliers] Price updated for "${product.productName}" at "${supplier.name}": $${newCost}`);
  return supplier;
}

// ---------------------------------------------------------------------------
// Analytics helpers
// ---------------------------------------------------------------------------

export function getProductPriceHistory(catalogProductId: string): {
  supplier: string;
  supplierId: string;
  history: PriceHistoryEntry[];
  currentCost: number;
}[] {
  const suppliers = getAll();
  const results: { supplier: string; supplierId: string; history: PriceHistoryEntry[]; currentCost: number }[] = [];

  for (const s of suppliers) {
    const product = s.products.find((p) => p.catalogProductId === catalogProductId);
    if (product) {
      results.push({
        supplier: s.name,
        supplierId: s.id,
        history: product.priceHistory,
        currentCost: product.currentCost,
      });
    }
  }

  return results;
}

export function getPriceChangeSummary(): {
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
}[] {
  const suppliers = getAll();
  const results: any[] = [];

  for (const s of suppliers) {
    for (const p of s.products) {
      if (p.priceHistory.length === 0) continue;
      const first = p.priceHistory[0];
      const last = p.priceHistory[p.priceHistory.length - 1];
      const changePercent = first.cost > 0 ? ((last.cost - first.cost) / first.cost) * 100 : 0;

      results.push({
        productName: p.productName,
        sku: p.sku,
        catalogProductId: p.catalogProductId,
        supplier: s.name,
        firstCost: first.cost,
        currentCost: p.currentCost,
        changePercent,
        totalChanges: p.priceHistory.length - 1,
        firstDate: first.date,
        lastDate: last.date,
      });
    }
  }

  return results.sort((a, b) => b.changePercent - a.changePercent);
}
