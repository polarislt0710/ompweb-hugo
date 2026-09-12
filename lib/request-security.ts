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

function hostnameOf(host: string): string {
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return host.split(":")[0]?.toLowerCase() ?? host;
  }
}

function publicHostname(): string | null {
  const configured = process.env.OMP_WEB_PUBLIC_HOST?.trim();
  if (configured) return hostnameOf(configured);
  // Daily-driver Cloudflare Tunnel hostname. Middleware may not see .env.local.
  return "omp.bizobot.com";
}

function sameHostname(originA: string, originB: string): boolean {
  try {
    return new URL(originA).hostname.toLowerCase() === new URL(originB).hostname.toLowerCase();
  } catch {
    return false;
  }
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
  const chosen = forwardedHost || host;
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

  const originCanon = canonicalOrigin(origin);
  if (!originCanon) return false;

  const requestOrigin = getRequestOrigin(request);
  if (requestOrigin && originCanon === requestOrigin) return true;
  // Cloudflare Tunnel terminates TLS: browser Origin is https, Next sees http.
  if (requestOrigin && sameHostname(originCanon, requestOrigin)) return true;

  const originHost = hostnameOf(new URL(originCanon).host);
  const forwardedHost = firstHeader(request, "x-forwarded-host");
  if (forwardedHost && hostnameOf(forwardedHost) === originHost) return true;
  const publicHost = publicHostname();
  if (publicHost && originHost === publicHost) return true;
  return false;
}

export function shouldCheckApiRequestOrigin(request: Request): boolean {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}
