import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../../lib/session";
import { machinesDB } from "../../../../../lib/machines";

// POST – Admin queues a product sync for the machine
// The RPi heartbeat will pick it up via GET on next cycle
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

  try {
    const body = await request.json();
    const products = body.products;

    if (!Array.isArray(products)) {
      return NextResponse.json({ ok: false, error: "products array requis" }, { status: 400 });
    }

    // Store pending sync – the RPi heartbeat will pull this
    machine.pendingSync = {
      products,
      queuedAt: new Date().toISOString(),
      queuedBy: me.email,
    };

    console.log(`[sync-products] Queued ${products.length} products for ${machineId} (will be pulled by heartbeat)`);

    return NextResponse.json({
      ok: true,
      message: `${products.length} produits en attente de synchronisation. La machine les récupérera au prochain heartbeat (~30s).`,
    });
  } catch (err) {
    console.error(`[sync-products] Error for ${machineId}:`, err);
    const msg = err instanceof Error ? err.message : "Erreur";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// GET – RPi heartbeat calls this to check for pending product syncs
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const machineId = params.id;
  const machine = machinesDB[machineId];

  if (!machine) {
    return NextResponse.json({ ok: true, pending: false });
  }

  if (machine.pendingSync) {
    const sync = machine.pendingSync;
    // Clear the pending sync once delivered
    delete machine.pendingSync;
    console.log(`[sync-products] Delivered ${sync.products.length} products to ${machineId}`);
    return NextResponse.json({ ok: true, pending: true, products: sync.products, queuedAt: sync.queuedAt });
  }

  return NextResponse.json({ ok: true, pending: false });
}
