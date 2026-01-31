import { NextRequest, NextResponse } from "next/server";

// Mock OTA trigger – à remplacer par un appel à l’agent (MQTT/HTTP)
async function triggerOTA(machineId: string, version?: string): Promise<{ success: boolean; message: string }> {
  // Exemple : envoyer un message MQTT ou appeler HTTP POST sur l’agent
  console.log(`[OTA] Trigger for ${machineId}${version ? ` to version ${version}` : ""}`);
  // Simuler un succès
  return { success: true, message: version ? `OTA v${version} initiated` : "OTA initiated (latest)" };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const machineId = params.id;
  if (!machineId) {
    return NextResponse.json({ error: "Machine ID required" }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const version = typeof body.version === "string" ? body.version : undefined;

    const result = await triggerOTA(machineId, version);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: result.message });
  } catch (err) {
    console.error(`OTA error for ${machineId}:`, err);
    return NextResponse.json({ error: "Failed to trigger OTA" }, { status: 500 });
  }
}
