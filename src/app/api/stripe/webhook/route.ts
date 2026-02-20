import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * POST /api/stripe/webhook
 *
 * Receives Stripe webhook events and forwards relevant Terminal events
 * to the appropriate RPi vend server.
 *
 * Stripe sends webhooks for:
 *   - terminal.reader.action_succeeded: Payment collected on reader
 *   - terminal.reader.action_failed: Reader action failed
 *   - terminal.reader.action_updated: Reader action status change
 *   - payment_intent.amount_capturable_updated: Auth amount changed
 *   - payment_intent.canceled: PaymentIntent was cancelled
 *
 * The RPi is identified by the reader's serial number or metadata,
 * which maps to a machine in our system.
 */

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const MACHINES_FILE = path.join(DATA_DIR, "machines.json");

interface MachineRecord {
  id: string;
  name: string;
  stripeReaderId?: string;
  source?: {
    ip?: string;
    forwardedFor?: string;
  };
  meta?: {
    ip?: string;
  };
  [key: string]: any;
}

function getMachines(): MachineRecord[] {
  try {
    if (fs.existsSync(MACHINES_FILE)) {
      return JSON.parse(fs.readFileSync(MACHINES_FILE, "utf-8"));
    }
  } catch {}
  return [];
}

function findMachineByReaderId(readerId: string): MachineRecord | undefined {
  const machines = getMachines();
  const exact = machines.find((m) => m.stripeReaderId === readerId);
  if (exact) return exact;
  // Fallback: if only one machine, use it
  if (machines.length === 1) return machines[0];
  return undefined;
}

function findMachineByMetadata(metadata: any): MachineRecord | undefined {
  if (!metadata?.machineId) return undefined;
  const machines = getMachines();
  return machines.find((m) => m.id === metadata.machineId);
}

function getMachineIp(machine: MachineRecord): string | null {
  const ip =
    machine.source?.forwardedFor || machine.source?.ip || machine.meta?.ip;
  if (!ip) return null;
  return ip.split(":")[0];
}

async function forwardToRpi(
  ip: string,
  eventType: string,
  payload: any
): Promise<any> {
  const url = `http://${ip}:5001/stripe/webhook`;
  const body = JSON.stringify({ eventType, payload });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    const data = await res.json();
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// Relevant event types to forward to RPi
const FORWARD_EVENTS = new Set([
  "terminal.reader.action_succeeded",
  "terminal.reader.action_failed",
  "terminal.reader.action_updated",
  "payment_intent.amount_capturable_updated",
  "payment_intent.canceled",
]);

export async function POST(request: NextRequest) {
  try {
    // Read raw body for signature verification
    const rawBody = await request.text();
    const sig = request.headers.get("stripe-signature") || "";

    // Verify webhook signature if secret is configured
    if (STRIPE_WEBHOOK_SECRET && sig) {
      const isValid = await verifyStripeSignature(
        rawBody,
        sig,
        STRIPE_WEBHOOK_SECRET
      );
      if (!isValid) {
        console.error("[STRIPE-WEBHOOK] Invalid signature");
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 400 }
        );
      }
    }

    const event = JSON.parse(rawBody);
    const eventType = event.type || "";
    const eventData = event.data?.object || {};

    console.log(
      `[STRIPE-WEBHOOK] ${eventType} id=${event.id}`
    );

    // Only forward relevant events
    if (!FORWARD_EVENTS.has(eventType)) {
      console.log(`[STRIPE-WEBHOOK] Ignoring event: ${eventType}`);
      return NextResponse.json({ received: true });
    }

    // Find the target machine
    let machine: MachineRecord | undefined;

    // For terminal.reader.* events, use the reader ID
    if (eventType.startsWith("terminal.reader.")) {
      const readerId = eventData.id || "";
      machine = findMachineByReaderId(readerId);
      if (!machine) {
        console.warn(
          `[STRIPE-WEBHOOK] No machine for reader ${readerId}`
        );
      }
    }

    // For payment_intent.* events, use metadata
    if (eventType.startsWith("payment_intent.")) {
      const metadata = eventData.metadata || {};
      machine = findMachineByMetadata(metadata);
      if (!machine) {
        // Try to find by reader from the latest charge
        const charges = eventData.charges?.data || [];
        if (charges.length > 0) {
          const readerMeta = charges[0]?.payment_method_details?.card_present?.reader;
          if (readerMeta) {
            machine = findMachineByReaderId(readerMeta);
          }
        }
      }
    }

    if (!machine) {
      // Fallback: try single machine
      const machines = getMachines();
      if (machines.length === 1) {
        machine = machines[0];
      }
    }

    if (!machine) {
      console.warn(`[STRIPE-WEBHOOK] No machine found for event ${eventType}`);
      return NextResponse.json({ received: true });
    }

    const rpiIp = getMachineIp(machine);
    if (!rpiIp) {
      console.warn(
        `[STRIPE-WEBHOOK] No IP for machine ${machine.id} (${machine.name})`
      );
      return NextResponse.json({ received: true });
    }

    // Forward to RPi
    try {
      const rpiResult = await forwardToRpi(rpiIp, eventType, event);
      console.log(
        `[STRIPE-WEBHOOK] Forwarded to ${rpiIp}: ${JSON.stringify(rpiResult).slice(0, 200)}`
      );
    } catch (fwdErr: any) {
      console.error(
        `[STRIPE-WEBHOOK] Forward to ${rpiIp} failed: ${fwdErr.message}`
      );
    }

    // Always respond 200 to Stripe
    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error(`[STRIPE-WEBHOOK] Error: ${err.message}`);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}

// GET /api/stripe/webhook – health check
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Stripe webhook endpoint active",
    protocol: "stripe_terminal",
  });
}

// ---------------------------------------------------------------------------
// Stripe signature verification (without external dependency)
// ---------------------------------------------------------------------------
async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string
): Promise<boolean> {
  try {
    const parts = header.split(",");
    let timestamp = "";
    let signatures: string[] = [];

    for (const part of parts) {
      const [key, value] = part.split("=");
      if (key === "t") timestamp = value;
      if (key === "v1") signatures.push(value);
    }

    if (!timestamp || signatures.length === 0) return false;

    // Check timestamp tolerance (5 minutes)
    const ts = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 300) return false;

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(signedPayload)
    );
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return signatures.includes(expected);
  } catch {
    return false;
  }
}
