import { NextResponse } from "next/server";
import { isMcpEnabled, protectedResourceMetadata } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

// RFC 9728; served at the root and at the /mcp path-suffixed location.
export async function GET() {
  if (!isMcpEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(protectedResourceMetadata(), { headers: { "Cache-Control": "no-store" } });
}
