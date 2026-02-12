// Custom server: Next.js + WebSocket on the same HTTP server
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { WebSocketServer } = require("ws");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// ── Shared state (imported by API routes via global) ──────────────────
// globalThis.__wsClients: Map<machineId, { ws, lastHeartbeat, info }>
// globalThis.__wsBroadcast: (machineId, message) => void
if (!globalThis.__wsClients) {
  globalThis.__wsClients = new Map();
}

function broadcastToMachine(machineId, message) {
  const client = globalThis.__wsClients.get(machineId);
  if (client && client.ws.readyState === 1) {
    client.ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}
globalThis.__wsBroadcast = broadcastToMachine;

// ── Heartbeat processing (reuse logic from API route) ─────────────────
function processHeartbeat(machineId, data) {
  // machinesDB is shared via globalThis (see src/lib/machines.ts)
  if (!globalThis.__machinesDB) globalThis.__machinesDB = {};
  const machinesDB = globalThis.__machinesDB;

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
      location: data.location || "Inconnue",
      firstSeen: new Date(),
      snapshots: {},
    };
  }

  const machine = machinesDB[machineId];
  machine.lastSeen = new Date();
  if (data.status) machine.status = data.status;
  if (data.sensors) machine.sensors = { ...machine.sensors, ...data.sensors };
  if (data.location) machine.location = data.location;
  if (data.firmware) machine.firmware = data.firmware;
  if (data.agentVersion) machine.agentVersion = data.agentVersion;
  if (data.uptime) machine.uptime = data.uptime;
  if (data.inventory) machine.inventory = data.inventory;
  if (data.snapshots) {
    machine.snapshots = data.snapshots;
    machine.snapshotsUpdatedAt = new Date().toISOString();
  }
  if (data.proximity) {
    machine.proximity = { ...data.proximity, updatedAt: new Date().toISOString() };
  }
  if (data.meta) machine.meta = data.meta;
  machine.source = {
    forwardedFor: data._forwardedFor,
    userAgent: data._userAgent,
    receivedAt: new Date().toISOString(),
    transport: "websocket",
  };
  machine.wsConnected = true;

  // Check for pending sync and send immediately
  if (machine.pendingSync) {
    const sync = machine.pendingSync;
    delete machine.pendingSync;
    const sent = broadcastToMachine(machineId, {
      type: "sync-products",
      products: sync.products,
      queuedAt: sync.queuedAt,
    });
    if (sent) {
      console.log(`[ws] Delivered pending sync (${sync.products.length} products) to ${machineId}`);
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────────
app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // WebSocket server on /ws path
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = parse(request.url, true);
    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws, request) => {
    let machineId = null;
    const forwardedFor = request.headers["x-forwarded-for"] || "";
    const userAgent = request.headers["user-agent"] || "";

    console.log(`[ws] New connection from ${forwardedFor || request.socket.remoteAddress}`);

    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case "auth": {
            // First message must be auth with machineId
            machineId = msg.machineId;
            if (!machineId) {
              ws.send(JSON.stringify({ type: "error", error: "machineId required" }));
              ws.close();
              return;
            }
            globalThis.__wsClients.set(machineId, {
              ws,
              connectedAt: new Date().toISOString(),
              info: { forwardedFor, userAgent },
            });
            console.log(`[ws] Machine ${machineId} authenticated (total: ${globalThis.__wsClients.size})`);
            ws.send(JSON.stringify({ type: "auth-ok", machineId }));
            break;
          }

          case "heartbeat": {
            if (!machineId) {
              ws.send(JSON.stringify({ type: "error", error: "Not authenticated" }));
              return;
            }
            msg.data._forwardedFor = forwardedFor;
            msg.data._userAgent = userAgent;
            processHeartbeat(machineId, msg.data);

            ws.send(JSON.stringify({
              type: "heartbeat-ack",
              ts: new Date().toISOString(),
            }));
            break;
          }

          case "sync-ack": {
            console.log(`[ws] ${machineId} acknowledged sync: ${msg.status}`);
            break;
          }

          default:
            console.log(`[ws] Unknown message type from ${machineId}: ${msg.type}`);
        }
      } catch (err) {
        console.error(`[ws] Bad message from ${machineId}:`, err.message);
      }
    });

    ws.on("close", () => {
      if (machineId) {
        globalThis.__wsClients.delete(machineId);
        // Mark machine as potentially offline (will be confirmed by missed heartbeats)
        console.log(`[ws] Machine ${machineId} disconnected (total: ${globalThis.__wsClients.size})`);
      }
    });

    ws.on("error", (err) => {
      console.error(`[ws] Error for ${machineId}:`, err.message);
    });
  });

  // Ping/pong to detect dead connections (every 30s)
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => clearInterval(pingInterval));

  server.listen(port, hostname, () => {
    console.log(`> Fleet Manager ready on http://${hostname}:${port}`);
    console.log(`> WebSocket server on ws://${hostname}:${port}/ws`);
  });
});
