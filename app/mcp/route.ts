import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { isMcpEnabled, mcpBaseUrl, verifyAccessToken } from "@/lib/mcp/oauth";
import { handleMcpPayload } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

const MAX_MCP_REQUEST_BYTES = 1024 * 1024;

function unauthorized() {
  return NextResponse.json(
    { error: "invalid_token", error_description: "Connect this server from ChatGPT to sign in" },
    {
      status: 401,
      headers: { "WWW-Authenticate": `Bearer resource_metadata="${mcpBaseUrl()}/.well-known/oauth-protected-resource/mcp", scope="omp"` },
    },
  );
}

/** Browsers never call this endpoint; a present Origin that is not ours is a DNS-rebinding or CSRF attempt. */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(mcpBaseUrl()).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isMcpEnabled()) return NextResponse.json({ error: "MCP connector is disabled" }, { status: 404 });
  if (!originAllowed(request)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  if (!verifyAccessToken(request.headers.get("authorization"))) return unauthorized();

  let payload: unknown;
  try {
    payload = await parseJsonWithinLimit(request, MAX_MCP_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, { status: 413 });
    }
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const body = await handleMcpPayload(payload, process.env.NEXT_PUBLIC_APP_VERSION ?? "0");
  if (body === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
