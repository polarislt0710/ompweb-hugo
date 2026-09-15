export const DEFAULT_BROWSER_URL = "http://127.0.0.1:8120";
export const DEFAULT_ALLOWLIST_HOSTS = ["127.0.0.1", "localhost"] as const;
export const BROWSER_PANE_STORAGE_KEY = "omp-browser-pane";
export const BROWSER_ALLOWLIST_STORAGE_KEY = "omp-browser-allowlist";

export type BrowserPaneReason =
  | "invalid"
  | "blocked-scheme"
  | "not-localhost"
  | "not-allowlisted"
  | "frame-blocked";

export type BrowserPaneKind = "loopback" | "remote";

export type BrowserPaneDecision =
  | { ok: true; href: string; kind: BrowserPaneKind }
  | { ok: false; reason: BrowserPaneReason; href?: string };

export type EmbedPolicy = "allowed" | "blocked" | "unknown";

export type BrowserPaneSurface = "iframe" | "cdp" | "checking" | "fallback";

/** Iframe localhost; everything else uses the experimental Live Chrome screencast. */
export function browserPaneSurface(
  decision: BrowserPaneDecision,
  embedPolicy: EmbedPolicy | "checking",
): BrowserPaneSurface {
  if (!decision.ok) return "fallback";
  if (decision.kind === "loopback") {
    if (embedPolicy === "checking") return "checking";
    if (embedPolicy === "allowed") return "iframe";
    return "cdp";
  }
  return "cdp";
}

export function parseAllowlist(raw: string | null | undefined): string[] {
  if (!raw) return [...DEFAULT_ALLOWLIST_HOSTS];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_ALLOWLIST_HOSTS];
    const hosts = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    return hosts.length > 0 ? [...new Set(hosts)] : [...DEFAULT_ALLOWLIST_HOSTS];
  } catch {
    return [...DEFAULT_ALLOWLIST_HOSTS];
  }
}

function hostAllowed(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowlist.some((entry) => {
    const allowed = entry.split(":")[0]?.toLowerCase();
    return allowed === host;
  });
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/** Fill a scheme when the address bar omits one. Loopback stays http; public hosts use https. */
export function inferBrowserHref(input: string): string {
  const trimmed = input.trim();
  if (/^(https?|javascript|data|file|vbscript):/i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1|\[::1\]|::1)(:|\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

export function inspectBrowserUrl(input: string, allowlist: readonly string[] = DEFAULT_ALLOWLIST_HOSTS): BrowserPaneDecision {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "invalid" };
  if (/^(javascript|data|file|vbscript):/i.test(trimmed)) {
    return { ok: false, reason: "blocked-scheme" };
  }
  let parsed: URL;
  try {
    parsed = new URL(inferBrowserHref(trimmed));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "blocked-scheme", href: parsed.href };
  }
  const kind: BrowserPaneKind = isLoopbackHost(parsed.hostname) ? "loopback" : "remote";
  if (kind === "loopback" && !hostAllowed(parsed.hostname, [...allowlist])) {
    return { ok: false, reason: "not-allowlisted", href: parsed.href };
  }
  return { ok: true, href: parsed.href, kind };
}

export function embedPolicyFromHeaders(headers: { get(name: string): string | null }): EmbedPolicy {
  const xfo = (headers.get("x-frame-options") ?? "").trim().toLowerCase();
  if (xfo === "deny" || xfo === "sameorigin" || xfo.startsWith("allow-from")) return "blocked";
  const csp = `${headers.get("content-security-policy") ?? ""};${headers.get("content-security-policy-report-only") ?? ""}`;
  const match = /(?:^|;)\s*frame-ancestors\s+([^;]+)/i.exec(csp);
  if (!match) return "allowed";
  const sources = match[1].trim().toLowerCase();
  if (!sources || sources === "'none'" || sources === "none") return "blocked";
  if (sources.split(/\s+/).includes("*")) return "allowed";
  return "blocked";
}

export async function probeEmbedPolicy(href: string, fetchImpl: typeof fetch = fetch): Promise<EmbedPolicy> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const head = await fetchImpl(href, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html" },
    });
    if (head.status !== 405 && head.status !== 501) {
      return embedPolicyFromHeaders(head.headers);
    }
    const get = await fetchImpl(href, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html", Range: "bytes=0-0" },
    });
    return embedPolicyFromHeaders(get.headers);
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

export type BrowserPaneSessionState = { url: string; open: boolean };

export function readBrowserPaneState(raw: string | null, sessionId: string | null): BrowserPaneSessionState {
  const fallback: BrowserPaneSessionState = { url: DEFAULT_BROWSER_URL, open: false };
  if (!raw || !sessionId) return fallback;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entry = parsed[sessionId];
    if (!entry || typeof entry !== "object") return fallback;
    const record = entry as { url?: unknown; open?: unknown };
    return {
      url: typeof record.url === "string" && record.url.trim() ? record.url : DEFAULT_BROWSER_URL,
      open: record.open === true,
    };
  } catch {
    return fallback;
  }
}

export function writeBrowserPaneState(
  raw: string | null,
  sessionId: string,
  next: BrowserPaneSessionState,
): string {
  let parsed: Record<string, BrowserPaneSessionState> = {};
  try {
    const current = raw ? JSON.parse(raw) : {};
    if (current && typeof current === "object") parsed = current as Record<string, BrowserPaneSessionState>;
  } catch {
    parsed = {};
  }
  parsed[sessionId] = next;
  return JSON.stringify(parsed);
}

export function fallbackCopy(reason: BrowserPaneReason): string {
  switch (reason) {
    case "frame-blocked":
    case "not-localhost":
      return "This site blocks in-app embedding. Open it in your system browser instead — sites like Perplexity send X-Frame-Options.";
    case "blocked-scheme":
      return "Only http and https URLs can load here.";
    case "not-allowlisted":
      return "This localhost host is not on the allowlist.";
    default:
      return "That address is not a valid URL.";
  }
}
