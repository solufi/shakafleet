import { NextRequest, NextResponse } from "next/server";

// Mock DB partagé avec heartbeat – à remplacer par Postgres/Redis
let machinesDB: Record<string, any> = {
  "shaka-0001": {
    id: "shaka-0001",
    name: "Station A - Galerie Lafayette",
    status: "offline",
    lastSeen: new Date(),
    uptime: "0j 0h 0m",
    inventory: {},
    cameraSnapshot: "/api/machines/shaka-0001/snapshot",
    sensors: { temp: 0, humidity: 0, doorOpen: false },
    firmware: "unknown",
    location: "Paris, 75001",
    firstSeen: new Date(),
  },
};

// Export pour que heartbeat puisse mettre à jour
export { machinesDB };

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // "online" | "offline" | null
  const location = searchParams.get("location");
  const lowStock = searchParams.get("lowStock"); // "true" | null

  let filtered = Object.values(machinesDB);

  if (status && ["online", "offline"].includes(status)) {
    filtered = filtered.filter((m: any) => m.status === status);
  }

  if (location) {
    filtered = filtered.filter((m: any) =>
      (m.location || "").toLowerCase().includes(location.toLowerCase())
    );
  }

  if (lowStock === "true") {
    filtered = filtered.filter((m: any) =>
      Object.values(m.inventory || {}).some((qty: any) => (qty as number) < 5)
    );
  }

  return NextResponse.json(filtered);
}
