import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // mTLS is enforced by Nginx on agent.shakadistribution.ca
  // This is just a stub MVP response.
  const body = await req.json().catch(() => ({}));

  return NextResponse.json({ ok: true, received: body, commands: [] });
}
