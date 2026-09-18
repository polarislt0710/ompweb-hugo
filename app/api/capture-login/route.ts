import { NextRequest, NextResponse } from "next/server";
import {
  CaptureProfileError,
  deleteCaptureProfile,
  finishCaptureLogin,
  isLoginWindowOpen,
  listCaptureProfiles,
  startCaptureLogin,
} from "@/lib/mcp/capture-profiles";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof CaptureProfileError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

function view() {
  return {
    profiles: listCaptureProfiles().map((profile) => ({
      slug: profile.slug,
      host: profile.host,
      url: profile.url,
      loggedInAt: profile.loggedInAt,
      lastUsedAt: profile.lastUsedAt,
      open: isLoginWindowOpen(profile.slug),
    })),
  };
}

/** GET /api/capture-login — the signed-in sessions capture_page may use. */
export async function GET() {
  try {
    return NextResponse.json(view());
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/capture-login
 *   { action: "start", url }   open a Chrome window on this machine to log in
 *   { action: "finish", slug } the owner is logged in: close it and keep the session
 */
export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};

    if (record.action === "start") {
      const profile = startCaptureLogin(record.url);
      return NextResponse.json({ profile: { slug: profile.slug, host: profile.host }, ...view() });
    }
    if (record.action === "finish") {
      finishCaptureLogin(record.slug);
      return NextResponse.json(view());
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/capture-login?slug=… — forget a saved session, cookies and all. */
export async function DELETE(request: NextRequest) {
  try {
    deleteCaptureProfile(request.nextUrl.searchParams.get("slug"));
    return NextResponse.json(view());
  } catch (error) {
    return errorResponse(error);
  }
}
