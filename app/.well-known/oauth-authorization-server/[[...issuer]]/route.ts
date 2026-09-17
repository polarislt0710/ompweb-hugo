import { NextResponse } from "next/server";
import { authorizationServerMetadata, isMcpEnabled } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

// RFC 8414 metadata for the ChatGPT connector's OAuth flow.
export async function GET() {
  if (!isMcpEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(authorizationServerMetadata(), { headers: { "Cache-Control": "no-store" } });
}
