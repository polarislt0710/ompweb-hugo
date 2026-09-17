import { NextResponse } from "next/server";
import { authorizationServerMetadata, isMcpEnabled } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

// Some MCP clients only probe the OpenID discovery path.
export async function GET() {
  if (!isMcpEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(authorizationServerMetadata(), { headers: { "Cache-Control": "no-store" } });
}
