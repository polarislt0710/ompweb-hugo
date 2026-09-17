// Stateless MCP (Streamable HTTP) request handling: JSON-RPC over POST with
// plain JSON responses. No server-initiated messages are needed, so there is
// no SSE stream and no session id.

import { callMcpTool, MCP_SERVER_INSTRUCTIONS, MCP_TOOLS } from "./tools";

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

function isRequest(value: unknown): value is JsonRpcRequest {
  return Boolean(value) && typeof value === "object" && (value as JsonRpcRequest).jsonrpc === "2.0" && typeof (value as JsonRpcRequest).method === "string";
}

function error(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handleOne(message: unknown, serverVersion: string): Promise<JsonRpcResponse | null> {
  if (!isRequest(message)) return error(null, -32600, "Invalid Request");
  const isNotification = message.id === undefined;
  const params = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : {};

  switch (message.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "ompweb", title: "OMP Web", version: serverVersion },
          instructions: MCP_SERVER_INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return isNotification ? null : { jsonrpc: "2.0", id: message.id ?? null, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id: message.id ?? null, result: { tools: MCP_TOOLS } };
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const result = await callMcpTool(name, params.arguments);
      return { jsonrpc: "2.0", id: message.id ?? null, result };
    }
    default:
      if (isNotification) return null;
      return error(message.id, -32601, `Method not found: ${message.method}`);
  }
}

/** Returns the JSON body to send, or null when the input held only notifications (HTTP 202). */
export async function handleMcpPayload(payload: unknown, serverVersion: string): Promise<unknown | null> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return error(null, -32600, "Empty batch");
    const responses = (await Promise.all(payload.map((message) => handleOne(message, serverVersion)))).filter(Boolean);
    return responses.length > 0 ? responses : null;
  }
  return handleOne(payload, serverVersion);
}
