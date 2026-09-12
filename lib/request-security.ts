function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function forwardedProto(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim().toLowerCase();
    if (first === "http" || first === "https") return first;
  }
  const visitor = request.headers.get("cf-visitor");
  if (visitor) {
    try {
      const scheme = JSON.parse(visitor).scheme;
      if (scheme === "http" || scheme === "https") return scheme;
    } catch {
      // ignore malformed cf-visitor
    }
  }
  return new URL(request.url).protocol.replace(":", "");
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.replace(/^\[|\]$/g, "").split(":")[0]?.toLowerCase() ?? "";
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function firstHeader(request: Request, name: string): string | null {
  const raw = request.headers.get(name);
  if (!raw) return null;
  const first = raw.split(",")[0].trim();
  return first || null;
}

/** Origin the browser used, even when a tunnel rewrites Host to 127.0.0.1. */
export function getExternalOrigin(request: Request): string | null {
  const proto = forwardedProto(request);
  const forwardedHost = firstHeader(request, "x-forwarded-host");
  const host = request.headers.get("host");
  const publicHost = process.env.OMP_WEB_PUBLIC_HOST?.trim() || null;
  const chosen = forwardedHost
    || (host && !isLoopbackHost(host) ? host : null)
    || publicHost
    || host;
  if (chosen) return canonicalOrigin(`${proto}://${chosen}`);
  return canonicalOrigin(request.url);
}

function getRequestOrigin(request: Request): string | null {
  return getExternalOrigin(request);
}

/** Reject browser cross-site API requests while preserving non-browser clients. */
export function isApiRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin) return fetchSite !== "cross-site";

  const requestOrigin = getRequestOrigin(request);
  return requestOrigin !== null && canonicalOrigin(origin) === requestOrigin;
}

export function shouldCheckApiRequestOrigin(request: Request): boolean {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}
