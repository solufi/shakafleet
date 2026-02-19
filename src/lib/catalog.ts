import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CatalogNutrition {
  calories: number;
  fat: string;
  sugar: string;
  protein: string;
}

export interface CatalogProduct {
  id: string;
  sku: string;            // code interne (ex: "SHAKA-PROT-001")
  name: string;
  brand: string;
  category: string;       // ex: "Boisson", "Snack", "Protéine"
  description: string;
  price: number;           // prix de vente suggéré
  cost: number;            // prix coûtant
  imageId: string;
  nutrition?: CatalogNutrition;
  warehouseStock: number;  // quantité en entrepôt
  active: boolean;         // produit actif dans le catalogue
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Storage – single JSON file on disk
// ---------------------------------------------------------------------------
const DATA_DIR = process.env.USERS_DATA_DIR || path.join(process.cwd(), "data");
const CATALOG_FILE = path.join(DATA_DIR, "catalog.json");
const CATALOG_IMAGES_DIR = path.join(DATA_DIR, "catalog-images");

function ensureDirs() {
  for (const dir of [DATA_DIR, CATALOG_IMAGES_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function readCatalog(): CatalogProduct[] {
  ensureDirs();
  if (!fs.existsSync(CATALOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(CATALOG_FILE, "utf-8")) as CatalogProduct[];
  } catch {
    return [];
  }
}

function writeCatalog(products: CatalogProduct[]) {
  ensureDirs();
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(products, null, 2), "utf-8");
}

// In-memory cache
let _cache: CatalogProduct[] | null = null;

function getAll(): CatalogProduct[] {
  if (!_cache) {
    _cache = readCatalog();
  }
  return _cache;
}

function persist(products: CatalogProduct[]) {
  _cache = products;
  writeCatalog(products);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listCatalog(opts?: { activeOnly?: boolean; category?: string }): CatalogProduct[] {
  let products = getAll();
  if (opts?.activeOnly) {
    products = products.filter((p) => p.active);
  }
  if (opts?.category) {
    products = products.filter((p) => p.category.toLowerCase() === opts.category!.toLowerCase());
  }
  return products;
}

export function getCatalogProduct(id: string): CatalogProduct | undefined {
  return getAll().find((p) => p.id === id);
}

export function getCatalogProductBySku(sku: string): CatalogProduct | undefined {
  return getAll().find((p) => p.sku.toLowerCase() === sku.toLowerCase());
}

export function createCatalogProduct(data: Omit<CatalogProduct, "id" | "createdAt" | "updatedAt">): CatalogProduct {
  const products = getAll();
  const now = new Date().toISOString();
  const product: CatalogProduct = {
    ...data,
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    active: data.active !== false,
    createdAt: now,
    updatedAt: now,
  };
  persist([...products, product]);
  console.log(`[catalog] Created "${product.name}" (SKU: ${product.sku})`);
  return product;
}

export function updateCatalogProduct(
  id: string,
  updates: Partial<Omit<CatalogProduct, "id" | "createdAt">>
): CatalogProduct {
  const products = getAll();
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error("Produit introuvable dans le catalogue");

  const updated = { ...products[idx], ...updates, updatedAt: new Date().toISOString() };
  const newProducts = [...products];
  newProducts[idx] = updated;
  persist(newProducts);
  console.log(`[catalog] Updated "${updated.name}" (SKU: ${updated.sku})`);
  return updated;
}

export function deleteCatalogProduct(id: string): boolean {
  const products = getAll();
  const filtered = products.filter((p) => p.id !== id);
  if (filtered.length === products.length) return false;
  persist(filtered);
  console.log(`[catalog] Deleted product ${id}`);
  return true;
}

export function adjustWarehouseStock(id: string, delta: number): CatalogProduct {
  const products = getAll();
  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error("Produit introuvable dans le catalogue");

  const updated = {
    ...products[idx],
    warehouseStock: Math.max(0, products[idx].warehouseStock + delta),
    updatedAt: new Date().toISOString(),
  };
  const newProducts = [...products];
  newProducts[idx] = updated;
  persist(newProducts);
  console.log(`[catalog] Stock adjusted for "${updated.name}": ${delta > 0 ? "+" : ""}${delta} → ${updated.warehouseStock}`);
  return updated;
}

export function getCategories(): string[] {
  const cats = new Set(getAll().map((p) => p.category).filter(Boolean));
  return Array.from(cats).sort();
}

// ---------------------------------------------------------------------------
// Catalog image storage
// ---------------------------------------------------------------------------

export function saveCatalogImage(productId: string, data: Buffer, ext: string): string {
  ensureDirs();
  const filename = `${productId}.${ext}`;
  fs.writeFileSync(path.join(CATALOG_IMAGES_DIR, filename), data);
  return filename;
}

export function getCatalogImage(productId: string): { data: Buffer; ext: string } | null {
  ensureDirs();
  for (const ext of ["webp", "jpg", "jpeg", "png"]) {
    const file = path.join(CATALOG_IMAGES_DIR, `${productId}.${ext}`);
    if (fs.existsSync(file)) {
      return { data: fs.readFileSync(file), ext };
    }
  }
  return null;
}

export function deleteCatalogImage(productId: string): boolean {
  for (const ext of ["webp", "jpg", "jpeg", "png"]) {
    const file = path.join(CATALOG_IMAGES_DIR, `${productId}.${ext}`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Inventory summary across all machines
// ---------------------------------------------------------------------------

export interface InventorySummary {
  catalogId: string;
  sku: string;
  name: string;
  warehouseStock: number;
  machineStock: { machineId: string; machineName: string; quantity: number; slot: string }[];
  totalInMachines: number;
  totalStock: number;
}
