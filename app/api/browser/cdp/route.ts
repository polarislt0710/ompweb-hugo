import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { CdpBrowserError, getCdpBrowser } from "@/lib/cdp-browser";
import { isCdpSessionId, type CdpInputEvent } from "@/lib/cdp-input";
import { inspectBrowserUrl } from "@/lib/browser-pane";
import { isApiRequestOriginAllowed, shouldCheckApiRequestOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

type CdpActionBody = {
  action?: unknown;
  sessionId?: unknown;
  url?: unknown;
  width?: unknown;
  height?: unknown;
  scale?: unknown;
  events?: unknown;
  accept?: unknown;
  promptText?: unknown;
};

function paneIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!isCdpSessionId(trimmed)) return null;
  return trimmed;
}

function navigateHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const inspected = inspectBrowserUrl(value);
  if (!inspected.ok) return null;
  return inspected.href;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function POST(request: Request) {
  if (shouldCheckApiRequestOrigin(request) && !isApiRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Forbidden", code: "forbidden_origin" }, { status: 403 });
  }

  try {
    const body = await request.json() as CdpActionBody;
    const action = typeof body.action === "string" ? body.action : "";
    const sessionId = paneIdOf(body.sessionId);
    if (!sessionId) {
      return NextResponse.json({ error: "Invalid session", code: "invalid_session" }, { status: 400 });
    }
    const host = getCdpBrowser();

    if (action === "ensure") {
      const href = navigateHref(body.url);
      if (!href) return NextResponse.json({ error: "Invalid URL", code: "invalid_url" }, { status: 400 });
      const result = await host.ensure(
        sessionId,
        href,
        numberOr(body.width, 400),
        numberOr(body.height, 720),
        numberOr(body.scale, 1),
      );
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "navigate") {
      const href = navigateHref(body.url);
      if (!href) return NextResponse.json({ error: "Invalid URL", code: "invalid_url" }, { status: 400 });
      await host.navigate(sessionId, href);
      return NextResponse.json({ ok: true });
    }
    if (action === "reload") {
      await host.reload(sessionId);
      return NextResponse.json({ ok: true });
    }
    if (action === "input") {
      if (!Array.isArray(body.events)) {
        return NextResponse.json({ error: "Invalid input", code: "invalid_input" }, { status: 400 });
      }
      await host.input(sessionId, body.events as CdpInputEvent[]);
      return NextResponse.json({ ok: true });
    }
    if (action === "resize") {
      await host.resize(sessionId, numberOr(body.width, 400), numberOr(body.height, 720), numberOr(body.scale, 1));
      return NextResponse.json({ ok: true });
    }
    if (action === "dialog") {
      await host.dialog(sessionId, body.accept === true, typeof body.promptText === "string" ? body.promptText : "");
      return NextResponse.json({ ok: true });
    }
    if (action === "focus") {
      await host.focus(sessionId);
      return NextResponse.json({ ok: true });
    }
    if (action === "stop") {
      await host.stop(sessionId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action", code: "invalid_action" }, { status: 400 });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof CdpBrowserError || code === "chrome_not_found" || code === "chrome_exited" || code === "cdp_not_started") {
      const status = code === "chrome_not_found" ? 503 : 500;
      return NextResponse.json({ error: message, code: code ?? "cdp_failed" }, { status });
    }
    return apiErrorResponse(error);
  }
}
