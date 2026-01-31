import { NextRequest, NextResponse } from "next/server";
import { machinesDB } from "../../../lib/machines";

function computeUptime(firstSeen: Date): string {
  const now = new Date();
  const diff = now.getTime() - firstSeen.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${days}j ${hours}h ${minutes}m`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      machineId,
      status,
      sensors,
      inventory,
      location,
      firmware,
      uptime,
    } = body;

    if (!machineId || typeof machineId !== "string") {
      return NextResponse.json({ error: "machineId required" }, { status: 400 });
    }

    // Crée ou met à jour la machine
    if (!machinesDB[machineId]) {
      machinesDB[machineId] = {
        id: machineId,
        name: `Station ${machineId.toUpperCase()}`,
        status: "offline",
        lastSeen: new Date(),
        uptime: "0j 0h 0m",
        inventory: {},
        cameraSnapshot: `/api/machines/${machineId}/snapshot`,
        sensors: { temp: 0, humidity: 0, doorOpen: false },
        firmware: "unknown",
        location: location || "Inconnue",
        firstSeen: new Date(),
      };
    }

    const machine = machinesDB[machineId];
    machine.lastSeen = new Date();
    if (status) machine.status = status;
    if (sensors) machine.sensors = { ...machine.sensors, ...sensors };
    if (inventory) machine.inventory = { ...machine.inventory, ...inventory };
    if (location) machine.location = location;
    if (firmware) machine.firmware = firmware;
    if (uptime) machine.uptime = uptime;
    else machine.uptime = computeUptime(machine.firstSeen);

    console.log(`[heartbeat] ${machineId} – status=${machine.status} sensors=${JSON.stringify(machine.sensors)}`);

    return NextResponse.json({ ok: true, received: { machineId, status, sensors, inventory } });
  } catch (err) {
    console.error("[heartbeat] error:", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}

// GET pour debug (optionnel)
export async function GET() {
  return NextResponse.json(Object.values(machinesDB));
}
