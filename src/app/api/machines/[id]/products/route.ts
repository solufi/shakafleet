import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../../lib/session";
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  reorderProducts,
  importProducts,
  type Product,
} from "../../../../../lib/products";
import { machinesDB } from "../../../../../lib/machines";

// GET /api/machines/[id]/products
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });

  const machineId = params.id;
  let products = listProducts(machineId);

  // Auto-import from heartbeat data if no products managed yet
  if (products.length === 0) {
    const machine = machinesDB[machineId];
    const hbProducts = machine?.inventory?.products;
    if (hbProducts && Array.isArray(hbProducts) && hbProducts.length > 0) {
      products = importProducts(machineId, hbProducts);
    }
  }

  return NextResponse.json({ ok: true, products });
}

// POST /api/machines/[id]/products – create or reorder
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  const machineId = params.id;

  try {
    const body = await request.json();

    // Reorder mode
    if (body.reorder && Array.isArray(body.orderedIds)) {
      const products = reorderProducts(machineId, body.orderedIds);
      return NextResponse.json({ ok: true, products });
    }

    // Create mode
    const { name, price, quantity, description, location, imageId, order, useRelay, visible, nutrition } = body;

    if (!name || price == null) {
      return NextResponse.json({ ok: false, error: "Nom et prix requis" }, { status: 400 });
    }

    const product = createProduct(machineId, {
      name,
      price: Number(price),
      quantity: Number(quantity ?? 0),
      description: description || "",
      location: location || "",
      imageId: imageId || "",
      order: Number(order ?? 999),
      useRelay: useRelay ?? false,
      visible: visible !== false,
      nutrition: nutrition || undefined,
    });

    return NextResponse.json({ ok: true, product });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}

// PATCH /api/machines/[id]/products – update a product
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  const machineId = params.id;

  try {
    const body = await request.json();
    const { productId, ...updates } = body;

    if (!productId) {
      return NextResponse.json({ ok: false, error: "productId requis" }, { status: 400 });
    }

    // Convert numeric fields
    if (updates.price != null) updates.price = Number(updates.price);
    if (updates.quantity != null) updates.quantity = Number(updates.quantity);
    if (updates.order != null) updates.order = Number(updates.order);

    const product = updateProduct(machineId, productId, updates);
    return NextResponse.json({ ok: true, product });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}

// DELETE /api/machines/[id]/products?productId=xxx
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  const machineId = params.id;
  const productId = request.nextUrl.searchParams.get("productId");

  if (!productId) {
    return NextResponse.json({ ok: false, error: "productId requis" }, { status: 400 });
  }

  try {
    deleteProduct(machineId, productId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}
