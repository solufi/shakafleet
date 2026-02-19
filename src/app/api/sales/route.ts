import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { recordSale, getSales, getDailySummaries, getOverallStats } from "../../../lib/sales";

// GET /api/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&machineId=xxx&view=daily|overview|raw
export async function GET(request: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });

  const from = request.nextUrl.searchParams.get("from") || undefined;
  const to = request.nextUrl.searchParams.get("to") || undefined;
  const machineId = request.nextUrl.searchParams.get("machineId") || undefined;
  const view = request.nextUrl.searchParams.get("view") || "daily";

  const opts = { from, to, machineId };

  if (view === "overview") {
    const stats = getOverallStats(opts);
    return NextResponse.json({ ok: true, stats });
  }

  if (view === "raw") {
    const sales = getSales(opts);
    return NextResponse.json({ ok: true, sales });
  }

  // Default: daily summaries
  const summaries = getDailySummaries(opts);
  const stats = getOverallStats(opts);
  return NextResponse.json({ ok: true, summaries, stats });
}

// POST /api/sales – record a new sale
export async function POST(request: NextRequest) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });

  try {
    const body = await request.json();
    const { machineId, productId, productName, sku, price, cost, quantity, paymentMethod } = body;

    if (!machineId || !productName || price == null) {
      return NextResponse.json({ ok: false, error: "machineId, productName et price requis" }, { status: 400 });
    }

    const sale = recordSale({
      machineId,
      productId: productId || "",
      productName,
      sku: sku || undefined,
      price: Number(price),
      cost: Number(cost || 0),
      quantity: Number(quantity || 1),
      paymentMethod: paymentMethod || "card",
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, sale });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Erreur" },
      { status: 400 }
    );
  }
}
