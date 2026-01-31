import { NextRequest, NextResponse } from "next/server";

// Mock reboot trigger – à remplacer par un appel à l’agent (MQTT/HTTP)
async function triggerReboot(machineId: string): Promise<{ success: boolean; message: string }> {
  // Exemple : envoyer un message MQTT ou appeler HTTP POST sur l’agent
  console.log(`[REBOOT] Trigger for ${machineId}`);
  // Simuler un succès
  return { success: true, message: "Reboot initiated" };
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
    const result = await triggerReboot(machineId);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: result.message });
  } catch (err) {
    console.error(`Reboot error for ${machineId}:`, err);
    return NextResponse.json({ error: "Failed to trigger reboot" }, { status: 500 });
  }
}
