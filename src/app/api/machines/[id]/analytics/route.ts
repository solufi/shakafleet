import { NextRequest, NextResponse } from "next/server";
import { machinesDB } from "../../../../../lib/machines";

/**
 * Serve analytics data from machinesDB (populated by heartbeat).
 * GET /api/machines/:id/analytics?period=today|week|events|summary|all
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const machineId = params.id;
  const machine = machinesDB[machineId];

  if (!machine) {
    return NextResponse.json({ error: "Machine not found" }, { status: 404 });
  }

  const proximity = machine.proximity;
  if (!proximity) {
    return NextResponse.json(
      {
        ok: false,
        error: "No proximity data yet. Waiting for heartbeat from RPi.",
        machineId,
      },
      { status: 200 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const period = searchParams.get("period") || "all";

  switch (period) {
    case "today":
      return NextResponse.json({
        ok: true,
        machineId,
        ...(proximity.today || { totals: null, hourly: [] }),
      });
    case "week":
      return NextResponse.json({
        ok: true,
        machineId,
        ...(proximity.week || { totals: null, daily: [] }),
      });
    case "events":
      return NextResponse.json({
        ok: true,
        machineId,
        events: proximity.events || [],
        count: (proximity.events || []).length,
      });
    case "summary":
      return NextResponse.json({
        ok: true,
        machineId,
        ...(proximity.summary || {}),
      });
    case "all":
    default:
      return NextResponse.json({
        ok: true,
        machineId,
        updatedAt: proximity.updatedAt,
        summary: proximity.summary || null,
        today: proximity.today || null,
        week: proximity.week || null,
        events: proximity.events || [],
        live: proximity.live || null,
      });
  }
}
