import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../../lib/session";
import { machinesDB } from "../../../../../lib/machines";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  const machineId = params.id;
  const machine = machinesDB[machineId];

  if (!machine) {
    return NextResponse.json({ ok: false, error: "Machine introuvable" }, { status: 404 });
  }

  // Get machine IP from heartbeat meta
  const ip = machine.meta?.ip;
  if (!ip) {
    return NextResponse.json({ ok: false, error: "IP de la machine inconnue (pas de heartbeat reçu)" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const products = body.products;

    if (!Array.isArray(products)) {
      return NextResponse.json({ ok: false, error: "products array requis" }, { status: 400 });
    }

    // Push products to RPi local API
    const vendPort = machine.meta?.vend_port || 5001;

    // The RPi Shaka UI has a /api/local-products endpoint
    const uiPort = 3000;
    const url = `http://${ip}:${uiPort}/api/local-products`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `RPi responded ${res.status}: ${text}` },
        { status: 502 }
      );
    }

    const data = await res.json().catch(() => ({}));

    console.log(`[sync-products] Pushed ${products.length} products to ${machineId} (${ip}:${uiPort})`);

    return NextResponse.json({
      ok: true,
      message: `${products.length} produits synchronisés vers ${machineId}`,
      rpiResponse: data,
    });
  } catch (err) {
    console.error(`[sync-products] Error for ${machineId}:`, err);
    const msg = err instanceof Error ? err.message : "Erreur de synchronisation";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
