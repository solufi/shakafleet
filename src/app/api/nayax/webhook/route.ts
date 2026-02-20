import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/nayax/webhook
 *
 * Receives Spark webhook callbacks from Nayax servers and forwards them
 * to the appropriate RPi vend server for processing.
 *
 * Nayax sends webhooks for:
 *   - StartSession: Consumer started a session at the device
 *   - InfoQuery: Nayax asks for product/tariff info
 *   - TransactionNotify: Payment authorized or denied
 *   - TimeoutCallback: Session timed out
 *   - StopCallback: Session stopped by card tap
 *   - DeclineCallback: Transaction declined
 *
 * The RPi is identified by the TerminalId in the payload, which maps
 * to a machine in our system. We look up the machine's IP from heartbeat
 * data and forward the webhook to the RPi's /nayax/webhook endpoint.
 */

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const MACHINES_FILE = path.join(DATA_DIR, "machines.json");

interface MachineRecord {
  id: string;
  name: string;
  nayaxTerminalId?: string;
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

function findMachineByTerminalId(terminalId: string): MachineRecord | undefined {
  const machines = getMachines();
  // First try exact match on nayaxTerminalId
  const exact = machines.find((m) => m.nayaxTerminalId === terminalId);
  if (exact) return exact;
  // Fallback: if only one machine, use it
  if (machines.length === 1) return machines[0];
  return undefined;
}

function getMachineIp(machine: MachineRecord): string | null {
  // Try heartbeat source IP first, then meta IP
  const ip = machine.source?.forwardedFor || machine.source?.ip || machine.meta?.ip;
  if (!ip) return null;
  // Strip port if present
  return ip.split(":")[0];
}

async function forwardToRpi(ip: string, eventType: string, payload: any): Promise<any> {
  const url = `http://${ip}:5001/nayax/webhook`;
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

// POST /api/nayax/webhook
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    // Determine event type from the URL path or payload
    // Nayax may send different webhook types to different URLs,
    // or include the type in the payload
    const eventType =
      payload.EventType ||
      payload.eventType ||
      request.nextUrl.searchParams.get("event") ||
      "Unknown";

    const terminalId = payload.TerminalId || payload.terminalId || "";
    const sparkTxnId = payload.SparkTransactionId || "";

    console.log(
      `[NAYAX-WEBHOOK] ${eventType} terminal=${terminalId} txn=${sparkTxnId}`
    );

    // Find the machine and forward to RPi
    const machine = findMachineByTerminalId(terminalId);

    if (!machine) {
      console.warn(
        `[NAYAX-WEBHOOK] No machine found for terminal ${terminalId}`
      );
      // Still respond OK to Nayax so they don't retry
      return NextResponse.json({
        ResultCode: 0,
        ResultDescription: "OK",
        SparkTransactionId: sparkTxnId,
      });
    }

    const rpiIp = getMachineIp(machine);

    if (!rpiIp) {
      console.warn(
        `[NAYAX-WEBHOOK] No IP for machine ${machine.id} (${machine.name})`
      );
      return NextResponse.json({
        ResultCode: 0,
        ResultDescription: "OK",
        SparkTransactionId: sparkTxnId,
      });
    }

    // Forward to RPi
    try {
      const rpiResult = await forwardToRpi(rpiIp, eventType, payload);
      console.log(
        `[NAYAX-WEBHOOK] Forwarded to ${rpiIp} -> ${JSON.stringify(rpiResult).slice(0, 200)}`
      );

      // Return the RPi's response to Nayax
      return NextResponse.json({
        ResultCode: rpiResult?.ResultCode ?? 0,
        ResultDescription: rpiResult?.ResultDescription ?? "OK",
        SparkTransactionId: sparkTxnId,
        ...rpiResult,
      });
    } catch (fwdErr: any) {
      console.error(
        `[NAYAX-WEBHOOK] Forward to ${rpiIp} failed: ${fwdErr.message}`
      );
      // Still respond OK to Nayax
      return NextResponse.json({
        ResultCode: 0,
        ResultDescription: "OK",
        SparkTransactionId: sparkTxnId,
      });
    }
  } catch (err: any) {
    console.error(`[NAYAX-WEBHOOK] Error: ${err.message}`);
    return NextResponse.json(
      { ResultCode: -1, ResultDescription: err.message },
      { status: 500 }
    );
  }
}

// GET /api/nayax/webhook – health check
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Nayax Spark webhook endpoint active",
    protocol: "spark",
  });
}
