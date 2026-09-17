import { NextResponse } from "next/server";
import { exchangeToken, isMcpEnabled, OAuthError } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export async function POST(request: Request) {
  if (!isMcpEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const text = await request.text();
    if (text.length > 16 * 1024) throw new OAuthError("invalid_request", "Request too large");
    const form = contentType.includes("application/json")
      ? new URLSearchParams(Object.entries(JSON.parse(text) as Record<string, unknown>).filter(([, value]) => typeof value === "string") as Array<[string, string]>)
      : new URLSearchParams(text);
    return NextResponse.json(await exchangeToken(form), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof OAuthError) {
      return NextResponse.json({ error: error.error, error_description: error.description }, { status: error.status, headers: NO_STORE });
    }
    return NextResponse.json({ error: "invalid_request", error_description: "Malformed token request" }, { status: 400, headers: NO_STORE });
  }
}
