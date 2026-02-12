import { NextRequest, NextResponse } from "next/server";
import { machinesDB } from "../../../../../lib/machines";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const machineId = params.id;
  if (!machineId) {
    return NextResponse.json({ error: "Machine ID required" }, { status: 400 });
  }

  const cameraId = request.nextUrl.searchParams.get("cam") || "camera_0";
  const machine = machinesDB[machineId];

  if (!machine?.snapshots?.[cameraId]) {
    // Return a placeholder SVG
    const svg = `<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
  <rect fill="#1a1a2e" width="640" height="360"/>
  <text fill="#555" font-family="sans-serif" font-size="20" x="50%" y="50%" text-anchor="middle" dy=".3em">
    Caméra indisponible
  </text>
</svg>`;
    return new NextResponse(svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" },
    });
  }

  try {
    const b64 = machine.snapshots[cameraId];
    const imgBuffer = Buffer.from(b64, "base64");
    return new NextResponse(new Uint8Array(imgBuffer), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=30",
      },
    });
  } catch (err) {
    console.error(`Snapshot error for ${machineId}:`, err);
    return NextResponse.json({ error: "Failed to decode snapshot" }, { status: 500 });
  }
}
