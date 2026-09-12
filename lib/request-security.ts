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

/** Origin the browser used, even when Next sees an internal http://127.0.0.1 URL. */
export function getExternalOrigin(request: Request): string | null {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = forwardedProto(request);
  if (host) return canonicalOrigin(`${proto}://${host}`);
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
