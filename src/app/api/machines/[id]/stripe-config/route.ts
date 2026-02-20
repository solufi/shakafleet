import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../../lib/session";
import { machinesDB } from "../../../../../lib/machines";
import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

/**
 * GET /api/machines/:id/stripe-config
 * Returns the saved Stripe config for a machine.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const machineId = params.id;

  // Try to load from file
  const configFile = path.join(DATA_DIR, "stripe-config", `${machineId}.json`);
  try {
    if (fs.existsSync(configFile)) {
      const raw = fs.readFileSync(configFile, "utf-8");
      const config = JSON.parse(raw);
      // Mask the secret key for security (only show last 4 chars)
      return NextResponse.json({
        ok: true,
        config: {
          ...config,
          secretKey: config.secretKey ? maskKey(config.secretKey) : "",
        },
      });
    }
  } catch {}

  return NextResponse.json({ ok: true, config: null });
}

/**
 * POST /api/machines/:id/stripe-config
 * Saves the Stripe config and pushes it to the RPi agent.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const me = await getSession();
  if (!me) return NextResponse.json({ ok: false, error: "Non authentifié" }, { status: 401 });
  if (me.role !== "admin") return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });

  const machineId = params.id;
  const machine = machinesDB[machineId];

  try {
    const body = await request.json();
    const {
      secretKey,
      readerId,
      simulation,
      decimalPlaces,
      apiTimeout,
      vendResultTimeout,
      preauthMaxAmount,
    } = body;

    // Load existing config to preserve full secret key if masked value sent
    const configDir = path.join(DATA_DIR, "stripe-config");
    const configFile = path.join(configDir, `${machineId}.json`);
    let existingConfig: any = {};
    try {
      if (fs.existsSync(configFile)) {
        existingConfig = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      }
    } catch {}

    // If the secret key looks masked (e.g. "sk_...****1234"), keep the existing one
    const resolvedSecretKey =
      secretKey && !secretKey.includes("****")
        ? secretKey
        : existingConfig.secretKey || "";

    const config = {
      secretKey: resolvedSecretKey,
      readerId: readerId || "",
      simulation: simulation ?? true,
      decimalPlaces: decimalPlaces ?? 2,
      apiTimeout: apiTimeout ?? 15,
      vendResultTimeout: vendResultTimeout ?? 30,
      preauthMaxAmount: preauthMaxAmount ?? 5000,
      updatedAt: new Date().toISOString(),
      updatedBy: me.email,
    };

    // Save to file
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    console.log(`[stripe-config] Saved config for ${machineId}`);

    // Build the env file content to push to RPi
    const envContent = buildEnvFile(config, machineId);

    // Try WebSocket push first
    const wsBroadcast = (globalThis as any).__wsBroadcast;
    if (
      wsBroadcast &&
      wsBroadcast(machineId, {
        type: "stripe-config",
        envContent,
        config: {
          readerId: config.readerId,
          simulation: config.simulation,
          decimalPlaces: config.decimalPlaces,
          apiTimeout: config.apiTimeout,
          vendResultTimeout: config.vendResultTimeout,
          preauthMaxAmount: config.preauthMaxAmount,
          // Include secret key for the agent to write to env file
          secretKey: config.secretKey,
        },
        updatedAt: config.updatedAt,
      })
    ) {
      console.log(`[stripe-config] Pushed to ${machineId} via WebSocket`);
      return NextResponse.json({
        ok: true,
        message: "Configuration envoyée via WebSocket",
        transport: "websocket",
      });
    }

    // Fallback: try direct HTTP push to RPi
    const rpiIp = machine?.source?.forwardedFor || machine?.source?.ip || machine?.meta?.ip;
    if (rpiIp) {
      const ip = rpiIp.split(":")[0];
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(`http://${ip}:5001/stripe/config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            envContent,
            config: {
              readerId: config.readerId,
              simulation: config.simulation,
              secretKey: config.secretKey,
            },
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const data = await res.json();
        if (data.ok) {
          console.log(`[stripe-config] Pushed to ${machineId} via HTTP (${ip})`);
          return NextResponse.json({
            ok: true,
            message: "Configuration envoyée directement au RPi",
            transport: "http-push",
          });
        }
      } catch (httpErr: any) {
        console.warn(`[stripe-config] HTTP push to ${ip} failed: ${httpErr.message}`);
      }
    }

    // Store as pending for heartbeat pickup
    if (machine) {
      machine.pendingStripeConfig = {
        envContent,
        config: {
          readerId: config.readerId,
          simulation: config.simulation,
          secretKey: config.secretKey,
        },
        queuedAt: new Date().toISOString(),
        queuedBy: me.email,
      };
    }

    return NextResponse.json({
      ok: true,
      message: "Configuration sauvegardée. En attente de livraison au prochain heartbeat.",
      transport: "http-pending",
    });
  } catch (err) {
    console.error(`[stripe-config] Error for ${machineId}:`, err);
    const msg = err instanceof Error ? err.message : "Erreur";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function maskKey(key: string): string {
  if (!key || key.length < 12) return key ? "****" : "";
  return key.slice(0, 7) + "****" + key.slice(-4);
}

function buildEnvFile(config: any, machineId: string): string {
  return [
    "# Stripe Terminal Configuration",
    "# Auto-generated by Fleet Manager",
    `# Updated: ${config.updatedAt}`,
    "",
    `STRIPE_SECRET_KEY=${config.secretKey}`,
    `STRIPE_READER_ID=${config.readerId}`,
    `MACHINE_ID=${machineId}`,
    `STRIPE_SIMULATION=${config.simulation ? "1" : "0"}`,
    `STRIPE_DECIMAL_PLACES=${config.decimalPlaces}`,
    `STRIPE_API_TIMEOUT=${config.apiTimeout}`,
    `STRIPE_VEND_RESULT_TIMEOUT=${config.vendResultTimeout}`,
    `STRIPE_PREAUTH_MAX_AMOUNT=${config.preauthMaxAmount}`,
    `STRIPE_STATE_FILE=/tmp/shaka_stripe_state.json`,
    "",
  ].join("\n");
}
