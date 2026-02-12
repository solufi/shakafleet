import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../../../../lib/session";
import { saveProductImage, getProductImage, deleteProductImage } from "../../../../../../../lib/products";

const MIME_MAP: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

// GET /api/machines/[id]/products/[pid]/image
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; pid: string } }
) {
  const { id: machineId, pid: productId } = params;
  const img = getProductImage(machineId, productId);

  if (!img) {
    const svg = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <rect fill="#1e293b" width="200" height="200" rx="12"/>
  <text fill="#475569" font-family="sans-serif" font-size="14" x="50%" y="50%" text-anchor="middle" dy=".3em">Pas d'image</text>
</svg>`;
    return new NextResponse(svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" },
    });
  }

  return new NextResponse(new Uint8Array(img.data), {
    headers: {
      "Content-Type": MIME_MAP[img.ext] || "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

// POST /api/machines/[id]/products/[pid]/image – upload image
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; pid: string } }
) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  const { id: machineId, pid: productId } = params;

  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "Fichier image requis" }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "Image trop grande (max 5MB)" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) {
      return NextResponse.json({ ok: false, error: "Format non supporté (jpg, png, webp)" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Delete old image first
    deleteProductImage(machineId, productId);
    const filename = saveProductImage(machineId, productId, buffer, ext);

    return NextResponse.json({ ok: true, filename });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur upload" },
      { status: 500 }
    );
  }
}

// DELETE /api/machines/[id]/products/[pid]/image
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; pid: string } }
) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  const { id: machineId, pid: productId } = params;
  deleteProductImage(machineId, productId);
  return NextResponse.json({ ok: true });
}
