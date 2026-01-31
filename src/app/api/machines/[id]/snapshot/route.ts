import { NextRequest, NextResponse } from "next/server";

// Mock snapshot – à remplacer par un vrai fetch vers l’agent
async function getSnapshotFromAgent(machineId: string): Promise<Buffer | null> {
  // Exemple : fetch(`http://${machineId}.local/snapshot`) puis Buffer
  // Ici on retourne une image placeholder SVG en base64
  const svg = `
<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
  <rect fill="#1a1a1a" width="640" height="360"/>
  <text fill="#666" font-family="sans-serif" font-size="24" x="50%" y="50%" text-anchor="middle" dy=".3em">
    Snapshot ${machineId}
  </text>
  <text fill="#444" font-family="sans-serif" font-size="14" x="50%" y="60%" text-anchor="middle" dy=".3em">
    Caméra indisponible (placeholder)
  </text>
</svg>`;
  const base64 = Buffer.from(svg.trim()).toString("base64");
  return Buffer.from(`data:image/svg+xml;base64,${base64}`);
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const machineId = params.id;
  if (!machineId) {
    return NextResponse.json({ error: "Machine ID required" }, { status: 400 });
  }

  try {
    const snapshot = await getSnapshotFromAgent(machineId);
    if (!snapshot) {
      return NextResponse.json({ error: "Snapshot not available" }, { status: 404 });
    }

    return new NextResponse(snapshot, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=30",
      },
    });
  } catch (err) {
    console.error(`Snapshot error for ${machineId}:`, err);
    return NextResponse.json({ error: "Failed to fetch snapshot" }, { status: 500 });
  }
}
