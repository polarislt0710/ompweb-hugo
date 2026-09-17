import { NextResponse } from "next/server";
import { isMcpEnabled, listClients, mcpResourceUrl, revokeAllAccess } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

/** GET /api/mcp-connector — connector URL, connected clients, and whether dispatch needs approval. */
export async function GET() {
  const clients = isMcpEnabled() ? listClients() : [];
  return NextResponse.json({
    enabled: isMcpEnabled(),
    url: mcpResourceUrl(),
    directDispatch: process.env.OMP_WEB_MCP_DIRECT_DISPATCH === "1",
    connected: clients.filter((client) => client.activeTokens > 0).map((client) => ({ name: client.clientName, kind: client.kind })),
  });
}

/** DELETE /api/mcp-connector — disconnect ChatGPT: every token and client registration is removed. */
export async function DELETE() {
  revokeAllAccess();
  return NextResponse.json({ ok: true });
}
