import { getCdpBrowser, type CdpClientEvent } from "@/lib/cdp-browser";
import { isCdpSessionId } from "@/lib/cdp-input";
import { isApiRequestOriginAllowed, shouldCheckApiRequestOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (shouldCheckApiRequestOrigin(request) && !isApiRequestOriginAllowed(request)) {
    return new Response(JSON.stringify({ error: "Forbidden", code: "forbidden_origin" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim() ?? "";
  if (!isCdpSessionId(sessionId)) {
    return new Response(JSON.stringify({ error: "Invalid session", code: "invalid_session" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let streamCleanup: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer !== null) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (unsubscribe) {
          try { unsubscribe(); } catch { /* ignore */ }
          unsubscribe = null;
        }
        request.signal?.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      streamCleanup = cleanup;

      const encode = (data: CdpClientEvent | { type: "connected"; sessionId: string }) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };

      heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);

      request.signal?.addEventListener("abort", cleanup);
      if (request.signal?.aborted) {
        cleanup();
        return;
      }

      encode({ type: "connected", sessionId });
      unsubscribe = getCdpBrowser().subscribe(sessionId, (event) => encode(event));
    },
    cancel() {
      streamCleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
