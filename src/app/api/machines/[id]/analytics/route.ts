import { NextRequest, NextResponse } from "next/server";
import { machinesDB } from "../../../../../lib/machines";

/**
 * Proxy analytics requests to the RPi vend server.
 * GET /api/machines/:id/analytics?period=today|week|date&date=2026-02-11
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

  // Determine the RPi IP from machine metadata
  const rpiIp = machine.source?.forwardedFor || machine.meta?.ip;
  if (!rpiIp) {
    return NextResponse.json(
      { error: "Machine IP not available. Wait for a heartbeat." },
      { status: 503 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const period = searchParams.get("period") || "today";
  const date = searchParams.get("date");

  let endpoint: string;
  switch (period) {
    case "week":
      endpoint = "/proximity/stats/week";
      break;
    case "date":
      endpoint = `/proximity/stats/date/${date || new Date().toISOString().split("T")[0]}`;
      break;
    case "events":
      endpoint = "/proximity/events";
      break;
    case "summary":
      endpoint = "/proximity/summary";
      break;
    case "today":
    default:
      endpoint = "/proximity/stats/today";
      break;
  }

  try {
    const rpiPort = 5001;
    const url = `http://${rpiIp}:${rpiPort}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const data = await res.json();
    return NextResponse.json({ ...data, machineId, rpiIp });
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to reach RPi at ${rpiIp}: ${err instanceof Error ? err.message : "unknown"}`,
        machineId,
      },
      { status: 502 }
    );
  }
}
