import { NextRequest, NextResponse } from "next/server";

// Mock DB – à remplacer par tes vraies requêtes Prisma/Postgres
const mockMachines = [
  {
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
  },
  {
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
  },
  {
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
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // "online" | "offline" | null
  const location = searchParams.get("location");
  const lowStock = searchParams.get("lowStock"); // "true" | null

  let filtered = mockMachines;

  if (status && ["online", "offline"].includes(status)) {
    filtered = filtered.filter((m) => m.status === status);
  }

  if (location) {
    filtered = filtered.filter((m) =>
      m.location.toLowerCase().includes(location.toLowerCase())
    );
  }

  if (lowStock === "true") {
    filtered = filtered.filter((m) =>
      Object.values(m.inventory).some((qty) => qty < 5)
    );
  }

  return NextResponse.json(filtered);
}
