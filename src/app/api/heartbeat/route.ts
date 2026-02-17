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
      agentVersion,
      uptime,
      meta,
      proximity,
      snapshots,
    } = body;

    const forwardedFor = request.headers.get("x-forwarded-for") || undefined;
    const requestUserAgent = request.headers.get("user-agent") || undefined;

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
        sensors: { temp: 0, humidity: 0, doorOpen: false },
        firmware: "unknown",
        agentVersion: "unknown",
        location: location || "Inconnue",
        firstSeen: new Date(),
        snapshots: {},
      };
    }

    const machine = machinesDB[machineId];
    machine.lastSeen = new Date();
    if (status) machine.status = status;
    if (sensors) machine.sensors = { ...machine.sensors, ...sensors };
    if (location) machine.location = location;
    if (firmware) machine.firmware = firmware;
    if (agentVersion) machine.agentVersion = agentVersion;
    if (uptime) machine.uptime = uptime;
    else machine.uptime = computeUptime(machine.firstSeen);
    if (inventory) machine.inventory = inventory;
    if (snapshots) {
      machine.snapshots = snapshots;
      machine.snapshotsUpdatedAt = new Date().toISOString();
    }

    // Proximity analytics (sent by RPi agent)
    if (proximity) {
      machine.proximity = {
        ...proximity,
        updatedAt: new Date().toISOString(),
      };
    }

    // Debug provenance (pour identifier les ghost machines)
    if (meta) {
      machine.meta = meta;
    }
    machine.source = {
      forwardedFor,
      userAgent: requestUserAgent,
      receivedAt: new Date().toISOString(),
    };

    const snapCount = snapshots ? Object.keys(snapshots).length : 0;
    const invCount = inventory?.totalProducts ?? 0;
    const nayaxInfo = meta?.nayax ? ` nayax=${meta.nayax.simulation ? "SIM" : meta.nayax.connected && meta.nayax.link?.link_ready ? "LIVE" : meta.nayax.connected ? "conn" : "off"}` : "";
    console.log(
      `[heartbeat] ${machineId} – status=${machine.status} uptime=${machine.uptime} door=${machine.sensors?.doorOpen ? "OPEN" : "closed"} snaps=${snapCount} inv=${invCount} agent=${agentVersion || "-"}${nayaxInfo}`
    );

    return NextResponse.json({ ok: true, received: { machineId, status, sensors, inventory: !!inventory, snapshots: snapCount, meta: !!meta, proximity: !!proximity } });
  } catch (err) {
    console.error("[heartbeat] error:", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}

// GET pour debug (optionnel)
export async function GET() {
  return NextResponse.json(Object.values(machinesDB));
}
