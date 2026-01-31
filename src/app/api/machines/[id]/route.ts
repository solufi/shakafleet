import { NextRequest, NextResponse } from "next/server";

// Mock DB – à remplacer par tes vraies requêtes Prisma/Postgres
const mockMachines: Record<string, any> = {
  "shaka-0001": {
    id: "shaka-0001",
    name: "Station A - Galerie Lafayette",
    status: "online" as const,
    lastSeen: new Date(Date.now() - 2 * 60 * 1000),
    uptime: "12j 4h 32m",
    inventory: { "Shaka Classic": 12, "Shaka Mango": 8, "Shaka Mint": 5 },
    cameraSnapshot: "/api/machines/shaka-0001/snapshot",
    sensors: { temp: 22.5, humidity: 45, doorOpen: false },
    firmware: "v2.1.3",
    location: "Paris, 75001",
    logs: [
      { ts: new Date(Date.now() - 10 * 60 * 1000), level: "info", msg: "Vending completed" },
      { ts: new Date(Date.now() - 25 * 60 * 1000), level: "warn", msg: "Low stock: Shaka Mango" },
      { ts: new Date(Date.now() - 45 * 60 * 1000), level: "info", msg: "Agent started" },
    ],
  },
  "shaka-0002": {
    id: "shaka-0002",
    name: "Station B - Centre Commercial",
    status: "offline" as const,
    lastSeen: new Date(Date.now() - 45 * 60 * 1000),
    uptime: "8j 12h 10m",
    inventory: { "Shaka Classic": 3, "Shaka Mango": 0, "Shaka Mint": 7 },
    cameraSnapshot: null,
    sensors: { temp: 24.1, humidity: 52, doorOpen: true },
    firmware: "v2.1.2",
    location: "Lyon, 69001",
    logs: [
      { ts: new Date(Date.now() - 50 * 60 * 1000), level: "error", msg: "Agent heartbeat missed" },
      { ts: new Date(Date.now() - 2 * 60 * 60 * 1000), level: "info", msg: "Vending completed" },
    ],
  },
  "shaka-0003": {
    id: "shaka-0003",
    name: "Station C - Aéroport",
    status: "online" as const,
    lastSeen: new Date(Date.now() - 30 * 1000),
    uptime: "21j 15h 5m",
    inventory: { "Shaka Classic": 20, "Shaka Mango": 15, "Shaka Mint": 12 },
    cameraSnapshot: "/api/machines/shaka-0003/snapshot",
    sensors: { temp: 20.8, humidity: 40, doorOpen: false },
    firmware: "v2.1.3",
    location: "Nice, 06000",
    logs: [
      { ts: new Date(Date.now() - 5 * 60 * 1000), level: "info", msg: "Vending completed" },
      { ts: new Date(Date.now() - 15 * 60 * 1000), level: "info", msg: "Inventory synced" },
      { ts: new Date(Date.now() - 30 * 60 * 1000), level: "info", msg: "Agent started" },
    ],
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const machineId = params.id;
  if (!machineId) {
    return NextResponse.json({ error: "Machine ID required" }, { status: 400 });
  }

  const machine = mockMachines[machineId];
  if (!machine) {
    return NextResponse.json({ error: "Machine not found" }, { status: 404 });
  }

  return NextResponse.json(machine);
}
