// Mock DB partagé – à remplacer par Postgres/Redis
export const machinesDB: Record<string, any> = {
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
