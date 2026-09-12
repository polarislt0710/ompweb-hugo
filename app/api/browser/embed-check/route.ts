import { NextResponse } from "next/server";
import { inspectBrowserUrl, probeEmbedPolicy } from "@/lib/browser-pane";
import { isApiRequestOriginAllowed, shouldCheckApiRequestOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (shouldCheckApiRequestOrigin(request) && !isApiRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Forbidden", code: "forbidden_origin" }, { status: 403 });
  }

  const raw = new URL(request.url).searchParams.get("url") ?? "";
  if (raw.length > 2048) {
    return NextResponse.json({ policy: "blocked", reason: "invalid" }, { status: 400 });
  }

  const inspected = inspectBrowserUrl(raw);
  if (!inspected.ok) {
    return NextResponse.json({ policy: "blocked", reason: inspected.reason, href: inspected.href ?? null });
  }
  if (inspected.kind === "loopback") {
    return NextResponse.json({ href: inspected.href, policy: "allowed" });
  }

  const policy = await probeEmbedPolicy(inspected.href);
  return NextResponse.json({ href: inspected.href, policy });
}
