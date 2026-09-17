import { NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-form-data";
import { isMcpEnabled, OAuthError, registerClient } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

// RFC 7591 dynamic client registration. Only ChatGPT redirect URIs are accepted,
// so a registered client can never receive codes anywhere else.
export async function POST(request: Request) {
  if (!isMcpEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1024);
    const client = registerClient(body);
    return NextResponse.json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OAuthError) {
      return NextResponse.json({ error: error.error, error_description: error.description }, { status: error.status });
    }
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "Invalid registration request" }, { status: 400 });
  }
}
