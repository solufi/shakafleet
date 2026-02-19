import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  addProductToSupplier,
  removeProductFromSupplier,
  updateProductCost,
  getPriceChangeSummary,
} from "../../../lib/suppliers";

// GET /api/suppliers?id=xxx&priceChanges=true
export async function GET(request: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  const priceChanges = request.nextUrl.searchParams.get("priceChanges") === "true";

  if (priceChanges) {
    const summary = getPriceChangeSummary();
    return NextResponse.json({ ok: true, priceChanges: summary });
  }

  if (id) {
    const supplier = getSupplier(id);
    if (!supplier) return NextResponse.json({ ok: false, error: "Fournisseur introuvable" }, { status: 404 });
    return NextResponse.json({ ok: true, supplier });
  }

  const suppliers = listSuppliers();
  return NextResponse.json({ ok: true, suppliers });
}

// POST /api/suppliers – create supplier OR manage products
export async function POST(request: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });

  try {
    const body = await request.json();

    // Add product to supplier
    if (body.action === "addProduct" && body.supplierId) {
      const supplier = addProductToSupplier(body.supplierId, {
        catalogProductId: body.catalogProductId,
        productName: body.productName,
        sku: body.sku || "",
        cost: Number(body.cost || 0),
        note: body.note,
      });
      return NextResponse.json({ ok: true, supplier });
    }

    // Remove product from supplier
    if (body.action === "removeProduct" && body.supplierId) {
      const supplier = removeProductFromSupplier(body.supplierId, body.catalogProductId);
      return NextResponse.json({ ok: true, supplier });
    }

    // Update product cost (adds to price history)
    if (body.action === "updateCost" && body.supplierId) {
      const supplier = updateProductCost(
        body.supplierId,
        body.catalogProductId,
        Number(body.cost),
        body.note
      );
      return NextResponse.json({ ok: true, supplier });
    }

    // Create new supplier
    const { name, contact, email, phone, address, website, notes, active } = body;
    if (!name) {
      return NextResponse.json({ ok: false, error: "Nom requis" }, { status: 400 });
    }

    const supplier = createSupplier({
      name,
      contact: contact || "",
      email: email || "",
      phone: phone || "",
      address: address || "",
      website: website || "",
      notes: notes || "",
      active: active !== false,
    });

    return NextResponse.json({ ok: true, supplier });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}

// PATCH /api/suppliers – update supplier
export async function PATCH(request: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });

  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ ok: false, error: "id requis" }, { status: 400 });

    const supplier = updateSupplier(id, updates);
    return NextResponse.json({ ok: true, supplier });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}

// DELETE /api/suppliers?id=xxx
export async function DELETE(request: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id requis" }, { status: 400 });

  try {
    deleteSupplier(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}
