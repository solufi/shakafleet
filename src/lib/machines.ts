// Mock DB partagé – à remplacer par Postgres/Redis
// Uses globalThis so the custom server.js and Next.js API routes share the same object
const g = globalThis as any;
if (!g.__machinesDB) {
  g.__machinesDB = {};
}
export const machinesDB: Record<string, any> = g.__machinesDB;
