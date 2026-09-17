import { NextRequest, NextResponse } from "next/server";
import { resolveProjectCwd } from "@/lib/api-project-cwd";
import { readHandoffFiles } from "@/lib/handoff";
import {
  decideDispatchRequest,
  DispatchError,
  listDispatchState,
  loadDispatchStore,
  readProjectPlan,
  startDispatch,
} from "@/lib/dispatch";
import { WebRpcError } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof DispatchError) {
    const status = error.code === "not_found" ? 404 : error.code === "already_decided" ? 409 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof WebRpcError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

/** GET /api/dispatch?cwd=/abs/project — parsed plan, recent runs and approval requests. */
export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveProjectCwd(request.nextUrl.searchParams.get("cwd"));
    if ("response" in resolved) return resolved.response;
    const { plan } = readProjectPlan(resolved.cwd);
    const planFile = readHandoffFiles(resolved.cwd).find((file) => file.name === "plan.md");
    return NextResponse.json({ plan, planModifiedAt: planFile?.modifiedAt ?? null, ...listDispatchState(resolved.cwd) });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/dispatch
 *   { action: "start", cwd, ticketIds? }     start a foreman run now
 *   { action: "decide", requestId, approve } approve or reject a ChatGPT request
 */
export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const ticketIds = Array.isArray(record.ticketIds) ? record.ticketIds.filter((id): id is string => typeof id === "string") : undefined;

    if (record.action === "start") {
      const resolved = await resolveProjectCwd(record.cwd);
      if ("response" in resolved) return resolved.response;
      const run = await startDispatch(resolved.cwd, ticketIds, "web");
      return NextResponse.json({ run });
    }

    if (record.action === "decide") {
      const requestId = typeof record.requestId === "string" ? record.requestId : "";
      const pending = loadDispatchStore().requests.find((entry) => entry.id === requestId);
      if (!pending) return NextResponse.json({ error: "Request not found", code: "not_found" }, { status: 404 });
      // Same project checks as a direct start: the request's cwd must still be an allowed project.
      const resolved = await resolveProjectCwd(pending.cwd);
      if ("response" in resolved) return resolved.response;
      return NextResponse.json(await decideDispatchRequest(requestId, record.approve === true));
    }

    return NextResponse.json({ error: "Unknown action", code: "invalid_action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
