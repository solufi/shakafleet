import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import {
  listCatalog,
  createCatalogProduct,
  updateCatalogProduct,
  deleteCatalogProduct,
  adjustWarehouseStock,
  getCategories,
  getSuppliers,
} from "../../../lib/catalog";

// GET /api/products?category=xxx&activeOnly=true
export async function GET(request: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });

  const category = request.nextUrl.searchParams.get("category") || undefined;
  const activeOnly = request.nextUrl.searchParams.get("activeOnly") === "true";

  const products = listCatalog({ activeOnly, category });
  const categories = getCategories();
  const suppliers = getSuppliers();

  return NextResponse.json({ ok: true, products, categories, suppliers });
}

// POST /api/products – create a new catalog product
export async function POST(request: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  try {
    const body = await request.json();

    // Stock adjustment mode
    if (body.adjustStock && body.id) {
      const product = adjustWarehouseStock(body.id, Number(body.delta || 0));
      return NextResponse.json({ ok: true, product });
    }

    const { sku, name, brand, category, supplier, description, price, cost, imageId, nutrition, warehouseStock, active } = body;

    if (!name || !sku) {
      return NextResponse.json({ ok: false, error: "Nom et SKU requis" }, { status: 400 });
    }

    const product = createCatalogProduct({
      sku,
      name,
      brand: brand || "",
      category: category || "",
      supplier: supplier || "",
      description: description || "",
      price: Number(price || 0),
      cost: Number(cost || 0),
      imageId: imageId || "",
      nutrition: nutrition || undefined,
      warehouseStock: Number(warehouseStock || 0),
      active: active !== false,
    });

    return NextResponse.json({ ok: true, product });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}

// PATCH /api/products – update a catalog product
export async function PATCH(request: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ ok: false, error: "id requis" }, { status: 400 });
    }

    if (updates.price != null) updates.price = Number(updates.price);
    if (updates.cost != null) updates.cost = Number(updates.cost);
    if (updates.warehouseStock != null) updates.warehouseStock = Number(updates.warehouseStock);

    const product = updateCatalogProduct(id, updates);
    return NextResponse.json({ ok: true, product });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}

// DELETE /api/products?id=xxx
export async function DELETE(request: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "id requis" }, { status: 400 });
  }

  try {
    deleteCatalogProduct(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}
