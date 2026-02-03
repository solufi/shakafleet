import { NextRequest, NextResponse } from "next/server";
import { machinesDB } from "../../../lib/machines";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // "online" | "offline" | null
  const location = searchParams.get("location");
  const lowStock = searchParams.get("lowStock"); // "true" | null

  let filtered = Object.values(machinesDB);

  if (status && ["online", "offline"].includes(status)) {
    filtered = filtered.filter((m: any) => m.status === status);
  }

  if (location) {
    filtered = filtered.filter((m: any) =>
      (m.location || "").toLowerCase().includes(location.toLowerCase())
    );
  }

  if (lowStock === "true") {
    filtered = filtered.filter((m: any) =>
      Object.values(m.inventory || {}).some((qty: any) => (qty as number) < 5)
    );
  }

  return NextResponse.json(filtered);
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  if (!machinesDB[id]) {
    return NextResponse.json({ error: "machine not found" }, { status: 404 });
  }

  delete machinesDB[id];
  return NextResponse.json({ ok: true, deletedId: id });
}
