import fs from "fs";
import path from "path";

export interface ProductNutrition {
  calories: number;
  fat: string;
  sugar: string;
  protein: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  cost?: number;
  quantity: number;
  imageId: string;
  description: string;
  location: string;
  order: number;
  useRelay?: boolean;
  visible?: boolean;
  nutrition?: ProductNutrition;
}

// ---------------------------------------------------------------------------
// Storage – JSON file per machine, persisted on disk
// ---------------------------------------------------------------------------
const DATA_DIR = process.env.USERS_DATA_DIR || path.join(process.cwd(), "data");
const PRODUCTS_DIR = path.join(DATA_DIR, "products");
const IMAGES_DIR = path.join(DATA_DIR, "product-images");

function ensureDirs() {
  for (const dir of [DATA_DIR, PRODUCTS_DIR, IMAGES_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function productsFile(machineId: string): string {
  return path.join(PRODUCTS_DIR, `${machineId}.json`);
}

function readProducts(machineId: string): Product[] {
  ensureDirs();
  const file = productsFile(machineId);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Product[];
  } catch {
    return [];
  }
}

function writeProducts(machineId: string, products: Product[]) {
  ensureDirs();
  fs.writeFileSync(productsFile(machineId), JSON.stringify(products, null, 2), "utf-8");
}

// In-memory cache per machine
const _cache: Record<string, Product[]> = {};
// Track which machines have been initialized (managed at least once)
const _initialized: Set<string> = new Set();

function getProducts(machineId: string): Product[] {
  if (!_cache[machineId]) {
    _cache[machineId] = readProducts(machineId);
  }
  // If products exist on disk, mark as initialized
  if (_cache[machineId].length > 0) {
    _initialized.add(machineId);
  }
  return _cache[machineId];
}

function persist(machineId: string, products: Product[]) {
  _cache[machineId] = products;
  _initialized.add(machineId);
  writeProducts(machineId, products);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listProducts(machineId: string): Product[] {
  return getProducts(machineId);
}

export function getProduct(machineId: string, productId: string): Product | undefined {
  return getProducts(machineId).find((p) => p.id === productId);
}

export function createProduct(machineId: string, data: Omit<Product, "id">): Product {
  const products = getProducts(machineId);
  const product: Product = {
    ...data,
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    visible: data.visible !== false,
  };
  persist(machineId, [...products, product]);
  console.log(`[products] Created "${product.name}" for machine ${machineId}`);
  return product;
}

export function updateProduct(
  machineId: string,
  productId: string,
  updates: Partial<Omit<Product, "id">>
): Product {
  const products = getProducts(machineId);
  const idx = products.findIndex((p) => p.id === productId);
  if (idx === -1) throw new Error("Produit introuvable");

  const updated = { ...products[idx], ...updates };
  const newProducts = [...products];
  newProducts[idx] = updated;
  persist(machineId, newProducts);
  console.log(`[products] Updated "${updated.name}" for machine ${machineId}`);
  return updated;
}

export function deleteProduct(machineId: string, productId: string): boolean {
  const products = getProducts(machineId);
  const filtered = products.filter((p) => p.id !== productId);
  if (filtered.length === products.length) return false;
  persist(machineId, filtered);
  console.log(`[products] Deleted product ${productId} from machine ${machineId}`);
  return true;
}

export function reorderProducts(machineId: string, orderedIds: string[]): Product[] {
  const products = getProducts(machineId);
  const reordered = orderedIds
    .map((id, i) => {
      const p = products.find((pr) => pr.id === id);
      return p ? { ...p, order: i } : null;
    })
    .filter(Boolean) as Product[];

  // Append any products not in the ordered list
  const orderedSet = new Set(orderedIds);
  const remaining = products
    .filter((p) => !orderedSet.has(p.id))
    .map((p, i) => ({ ...p, order: reordered.length + i }));

  const all = [...reordered, ...remaining];
  persist(machineId, all);
  return all;
}

export function isInitialized(machineId: string): boolean {
  // Check disk if not in memory yet
  if (!_initialized.has(machineId)) {
    const file = productsFile(machineId);
    if (fs.existsSync(file)) _initialized.add(machineId);
  }
  return _initialized.has(machineId);
}

export function importProducts(machineId: string, products: Product[]): Product[] {
  // Import products from heartbeat data (initial sync)
  if (isInitialized(machineId)) return getProducts(machineId); // Don't overwrite if already managed
  const existing = getProducts(machineId);
  if (existing.length > 0) return existing;

  const imported = products.map((p, i) => ({
    ...p,
    visible: p.visible !== false,
    order: p.order ?? i,
  }));
  persist(machineId, imported);
  console.log(`[products] Imported ${imported.length} products for machine ${machineId}`);
  return imported;
}

// ---------------------------------------------------------------------------
// Image storage
// ---------------------------------------------------------------------------

function imageDir(machineId: string): string {
  const dir = path.join(IMAGES_DIR, machineId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveProductImage(machineId: string, productId: string, data: Buffer, ext: string): string {
  const dir = imageDir(machineId);
  const filename = `${productId}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), data);
  return filename;
}

export function getProductImage(machineId: string, productId: string): { data: Buffer; ext: string } | null {
  const dir = imageDir(machineId);
  for (const ext of ["webp", "jpg", "jpeg", "png"]) {
    const file = path.join(dir, `${productId}.${ext}`);
    if (fs.existsSync(file)) {
      return { data: fs.readFileSync(file), ext };
    }
  }
  return null;
}

export function deleteProductImage(machineId: string, productId: string): boolean {
  const dir = imageDir(machineId);
  for (const ext of ["webp", "jpg", "jpeg", "png"]) {
    const file = path.join(dir, `${productId}.${ext}`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
  }
  return false;
}
