import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../../lib/session";
import { getCatalogProduct, saveCatalogImage, getCatalogImage, deleteCatalogImage } from "../../../../../lib/catalog";

// GET /api/products/[id]/image
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const img = getCatalogImage(params.id);
  if (!img) {
    return new NextResponse(null, { status: 404 });
  }
  const mime = img.ext === "png" ? "image/png" : img.ext === "webp" ? "image/webp" : "image/jpeg";
  return new NextResponse(img.data, {
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=3600" },
  });
}

// POST /api/products/[id]/image – upload
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  const product = getCatalogProduct(params.id);
  if (!product) return NextResponse.json({ ok: false, error: "Produit introuvable" }, { status: 404 });

  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "Aucun fichier" }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let ext = "jpg";
    if (file.type === "image/png") ext = "png";
    else if (file.type === "image/webp") ext = "webp";

    // Delete old images first
    deleteCatalogImage(params.id);
    const filename = saveCatalogImage(params.id, buffer, ext);

    return NextResponse.json({ ok: true, filename });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur upload" },
      { status: 500 }
    );
  }
}
