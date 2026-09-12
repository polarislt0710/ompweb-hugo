import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestOriginAllowed, shouldCheckApiRequestOrigin } from "@/lib/request-security";
import { isValidWebSession, isWebPasswordEnabled, OMP_WEB_SESSION_COOKIE } from "@/lib/web-auth";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Cloudflare Tunnel rewrites Host to 127.0.0.1. The login form POST must
  // still reach the route; knowing the password is the CSRF gate.
  if (pathname === "/api/web-auth/session") return NextResponse.next();

  if (pathname.startsWith("/api/") && shouldCheckApiRequestOrigin(request) && !isApiRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Cross-origin API requests are not allowed" }, { status: 403 });
  }
  if (!isWebPasswordEnabled()) {
    return pathname === "/login"
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }

  const hasSession = isValidWebSession(request.cookies.get(OMP_WEB_SESSION_COOKIE)?.value);
  if (pathname === "/login") {
    return hasSession ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (hasSession) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Password required", code: "password_required" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

// The sign-in screen still needs its Next.js JavaScript and CSS before a
// session exists; these are public build assets, not workspace data. The
// same goes for the web app manifest and its icons: browsers fetch them
// without cookies, and a login redirect there breaks PWA installation.
export const config = { matcher: "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|icon\\.svg|icon\\.png|icon-192\\.png).*)" };
