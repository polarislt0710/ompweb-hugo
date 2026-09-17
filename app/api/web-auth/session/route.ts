import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { getExternalOrigin } from "@/lib/request-security";
import {
  createWebSession,
  safeLoginNext,
  isValidWebPassword,
  isWebPasswordEnabled,
  OMP_WEB_SESSION_COOKIE,
  OMP_WEB_SESSION_MAX_AGE_SECONDS,
} from "@/lib/web-auth";

const MAX_PASSWORD_REQUEST_BYTES = 8 * 1024;

function wantsBrowserRedirect(request: Request, contentType: string): boolean {
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    return true;
  }
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function redirectTo(request: Request, path: string): NextResponse {
  const origin = getExternalOrigin(request) ?? new URL(request.url).origin;
  return NextResponse.redirect(new URL(path, origin), 303);
}

function attachSessionCookie(response: NextResponse, request: Request): NextResponse {
  const origin = getExternalOrigin(request) ?? new URL(request.url).origin;
  const secure = origin.startsWith("https:")
    || new URL(request.url).protocol === "https:"
    || request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
  response.cookies.set({
    name: OMP_WEB_SESSION_COOKIE,
    value: createWebSession(process.env.OMP_WEB_PASSWORD!),
    httpOnly: true,
    secure,
    // Public HTTPS hosts (Cloudflare quick tunnels) often drop SameSite=Lax
    // cookies after fetch(). None+Secure survives that; local HTTP stays Lax.
    sameSite: secure ? "none" : "lax",
    maxAge: OMP_WEB_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}

async function readLogin(request: Request): Promise<{ password: string | null; next: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await parseJsonWithinLimit(request, MAX_PASSWORD_REQUEST_BYTES) as { password?: unknown };
    return { password: typeof body.password === "string" ? body.password : null, next: "/" };
  }
  const form = await request.formData();
  const password = form.get("password");
  return { password: typeof password === "string" ? password : null, next: safeLoginNext(form.get("next")) };
}

export async function POST(request: Request) {
  if (!isWebPasswordEnabled()) {
    return NextResponse.json({ error: "Password protection is disabled" }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const html = wantsBrowserRedirect(request, contentType);

  let password: string | null;
  let next = "/";
  try {
    ({ password, next } = await readLogin(request));
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    if (html) return redirectTo(request, "/login?error=1");
    return NextResponse.json({ error: "Invalid password request" }, { status });
  }

  if (typeof password !== "string" || !isValidWebPassword(password)) {
    if (html) return redirectTo(request, next === "/" ? "/login?error=1" : `/login?error=1&next=${encodeURIComponent(next)}`);
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const response = html ? redirectTo(request, next) : NextResponse.json({ ok: true });
  return attachSessionCookie(response, request);
}
