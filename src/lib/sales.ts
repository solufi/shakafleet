import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Sale {
  id: string;
  machineId: string;
  productId: string;
  productName: string;
  sku?: string;
  price: number;        // prix de vente
  cost: number;         // prix coûtant
  profit: number;       // price - cost
  quantity: number;
  paymentMethod: "cash" | "card" | "stripe" | "free" | "other";
  timestamp: string;    // ISO 8601
  date: string;         // YYYY-MM-DD (for grouping)
}

export interface DailySummary {
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
}

// ---------------------------------------------------------------------------
// Storage – JSON file per month (YYYY-MM.json)
// ---------------------------------------------------------------------------
const DATA_DIR = process.env.USERS_DATA_DIR || path.join(process.cwd(), "data");
const SALES_DIR = path.join(DATA_DIR, "sales");

function ensureDirs() {
  for (const dir of [DATA_DIR, SALES_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function salesFile(yearMonth: string): string {
  return path.join(SALES_DIR, `${yearMonth}.json`);
}

function readMonth(yearMonth: string): Sale[] {
  ensureDirs();
  const file = salesFile(yearMonth);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Sale[];
  } catch {
    return [];
  }
}

function writeMonth(yearMonth: string, sales: Sale[]) {
  ensureDirs();
  fs.writeFileSync(salesFile(yearMonth), JSON.stringify(sales, null, 2), "utf-8");
}

// In-memory cache per month
const _cache: Record<string, Sale[]> = {};

function getMonth(yearMonth: string): Sale[] {
  if (!_cache[yearMonth]) {
    _cache[yearMonth] = readMonth(yearMonth);
  }
  return _cache[yearMonth];
}

function persistMonth(yearMonth: string, sales: Sale[]) {
  _cache[yearMonth] = sales;
  writeMonth(yearMonth, sales);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toYearMonth(date: string): string {
  return date.slice(0, 7); // "2026-02-19" → "2026-02"
}

function toDateStr(ts: string): string {
  return ts.slice(0, 10); // ISO → "YYYY-MM-DD"
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function recordSale(data: Omit<Sale, "id" | "profit" | "date">): Sale {
  const date = toDateStr(data.timestamp);
  const yearMonth = toYearMonth(date);
  const sales = getMonth(yearMonth);

  const sale: Sale = {
    ...data,
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    profit: (data.price - data.cost) * data.quantity,
    date,
  };

  persistMonth(yearMonth, [...sales, sale]);
  console.log(`[sales] Recorded sale: ${sale.productName} x${sale.quantity} = $${(sale.price * sale.quantity).toFixed(2)} (machine: ${sale.machineId})`);
  return sale;
}

export function getSales(opts: {
  from?: string;   // YYYY-MM-DD
  to?: string;     // YYYY-MM-DD
  machineId?: string;
}): Sale[] {
  const from = opts.from || "2020-01-01";
  const to = opts.to || "2099-12-31";

  // Determine which month files to read
  const fromYM = toYearMonth(from);
  const toYM = toYearMonth(to);

  ensureDirs();
  const allFiles = fs.readdirSync(SALES_DIR).filter((f) => f.endsWith(".json")).sort();
  const relevantFiles = allFiles.filter((f) => {
    const ym = f.replace(".json", "");
    return ym >= fromYM && ym <= toYM;
  });

  let sales: Sale[] = [];
  for (const f of relevantFiles) {
    const ym = f.replace(".json", "");
    const monthSales = getMonth(ym);
    sales = sales.concat(monthSales);
  }

  // Filter by date range
  sales = sales.filter((s) => s.date >= from && s.date <= to);

  // Filter by machine
  if (opts.machineId) {
    sales = sales.filter((s) => s.machineId === opts.machineId);
  }

  return sales.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function getDailySummaries(opts: {
  from?: string;
  to?: string;
  machineId?: string;
}): DailySummary[] {
  const sales = getSales(opts);

  const byDay: Record<string, Sale[]> = {};
  for (const sale of sales) {
    if (!byDay[sale.date]) byDay[sale.date] = [];
    byDay[sale.date].push(sale);
  }

  const summaries: DailySummary[] = [];
  for (const [date, daySales] of Object.entries(byDay)) {
    const totalRevenue = daySales.reduce((sum, s) => sum + s.price * s.quantity, 0);
    const totalCost = daySales.reduce((sum, s) => sum + s.cost * s.quantity, 0);
    const totalProfit = totalRevenue - totalCost;
    const totalSales = daySales.reduce((sum, s) => sum + s.quantity, 0);

    const byMachine: DailySummary["byMachine"] = {};
    const byProduct: DailySummary["byProduct"] = {};
    const byPayment: DailySummary["byPayment"] = {};

    for (const s of daySales) {
      // By machine
      if (!byMachine[s.machineId]) byMachine[s.machineId] = { revenue: 0, cost: 0, profit: 0, count: 0 };
      byMachine[s.machineId].revenue += s.price * s.quantity;
      byMachine[s.machineId].cost += s.cost * s.quantity;
      byMachine[s.machineId].profit += s.profit;
      byMachine[s.machineId].count += s.quantity;

      // By product
      const pKey = s.productId;
      if (!byProduct[pKey]) byProduct[pKey] = { name: s.productName, revenue: 0, cost: 0, profit: 0, count: 0 };
      byProduct[pKey].revenue += s.price * s.quantity;
      byProduct[pKey].cost += s.cost * s.quantity;
      byProduct[pKey].profit += s.profit;
      byProduct[pKey].count += s.quantity;

      // By payment
      if (!byPayment[s.paymentMethod]) byPayment[s.paymentMethod] = { revenue: 0, count: 0 };
      byPayment[s.paymentMethod].revenue += s.price * s.quantity;
      byPayment[s.paymentMethod].count += s.quantity;
    }

    summaries.push({
      date,
      totalSales,
      totalRevenue,
      totalCost,
      totalProfit,
      avgMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
      transactions: daySales.length,
      byMachine,
      byProduct,
      byPayment,
    });
  }

  return summaries.sort((a, b) => a.date.localeCompare(b.date));
}

export function getOverallStats(opts: {
  from?: string;
  to?: string;
  machineId?: string;
}): {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  totalSales: number;
  transactions: number;
  avgMargin: number;
  avgOrderValue: number;
  topProducts: { name: string; revenue: number; profit: number; count: number }[];
  topMachines: { machineId: string; revenue: number; profit: number; count: number }[];
} {
  const sales = getSales(opts);

  const totalRevenue = sales.reduce((sum, s) => sum + s.price * s.quantity, 0);
  const totalCost = sales.reduce((sum, s) => sum + s.cost * s.quantity, 0);
  const totalProfit = totalRevenue - totalCost;
  const totalSales = sales.reduce((sum, s) => sum + s.quantity, 0);

  const productMap: Record<string, { name: string; revenue: number; profit: number; count: number }> = {};
  const machineMap: Record<string, { machineId: string; revenue: number; profit: number; count: number }> = {};

  for (const s of sales) {
    if (!productMap[s.productId]) productMap[s.productId] = { name: s.productName, revenue: 0, profit: 0, count: 0 };
    productMap[s.productId].revenue += s.price * s.quantity;
    productMap[s.productId].profit += s.profit;
    productMap[s.productId].count += s.quantity;

    if (!machineMap[s.machineId]) machineMap[s.machineId] = { machineId: s.machineId, revenue: 0, profit: 0, count: 0 };
    machineMap[s.machineId].revenue += s.price * s.quantity;
    machineMap[s.machineId].profit += s.profit;
    machineMap[s.machineId].count += s.quantity;
  }

  return {
    totalRevenue,
    totalCost,
    totalProfit,
    totalSales,
    transactions: sales.length,
    avgMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
    avgOrderValue: sales.length > 0 ? totalRevenue / sales.length : 0,
    topProducts: Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    topMachines: Object.values(machineMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
  };
}
