import { NextResponse } from "next/server";
import { apiErrorResponse, resolveSessionPathOr404 } from "@/lib/api-utils";
import { getSessionUsageBreakdown } from "@/lib/session-usage";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessions/[id]/usage
 *
 * Token and API-equivalent cost breakdown for one session: the parent
 * transcript plus every subagent transcript in its artifacts directory.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const resolved = await resolveSessionPathOr404(id);
    if ("response" in resolved) return resolved.response;
    return NextResponse.json(getSessionUsageBreakdown(resolved.filePath));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
