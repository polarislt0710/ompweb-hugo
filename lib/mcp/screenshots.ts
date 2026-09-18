// Eyes for the reviewer: hand ChatGPT an image of a screen instead of only the
// markup behind it.
//
// Three sources:
// - an image file already in the project (a design mockup, a saved screenshot);
// - an HTML file in the project, or a dev server the owner started here;
// - a public site the owner deployed (orcagrade.com and friends).
//
// The last one is why the address checks matter. A screenshot tool that will
// fetch any host is a way to reach private networks from this machine, so every
// target's address is resolved first and anything private, loopback (unless it
// is an explicit localhost dev server), link-local or otherwise internal is
// refused. OMP_WEB_MCP_CAPTURE_HOSTS narrows it further to named hosts.
//
// Nothing here starts a dev server or runs a project command.

import { lookup } from "dns/promises";
import { readFileSync, statSync } from "fs";
import { isIP } from "net";
import { resolveChromeBinary } from "../chrome-path";
import { captureAll, type CaptureRequest, type CaptureResult, type Viewport } from "./capture";
import { captureProfileForHost, cloneProfileForCapture, readSavedSession, touchCaptureProfile } from "./capture-profiles";
import { ProjectAccessError, resolveReadablePath, type ConnectorProject } from "./project-files";

/** ChatGPT has to carry the image in the conversation, so keep it small. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TARGETS = 6;
export const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;

export const VIEWPORTS: Record<string, Viewport> = {
  desktop: { name: "desktop", width: 1280, height: 900, mobile: false },
  phone: { name: "phone", width: 390, height: 844, mobile: true },
};

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

export interface CapturedImage {
  data: string;
  mimeType: string;
  bytes: number;
  /** What was captured, for the line that accompanies the picture. */
  source: string;
}

function imageTypeFor(path: string): string | null {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? null : IMAGE_TYPES[path.slice(dot).toLowerCase()] ?? null;
}

/** An image file that already exists in the project (mockup, saved screenshot). */
export async function readProjectImage(project: ConnectorProject, rawPath: unknown): Promise<CapturedImage> {
  const { absolute, relative } = await resolveReadablePath(project, rawPath);
  const mimeType = imageTypeFor(relative);
  if (!mimeType) {
    throw new ProjectAccessError("invalid_argument", `${relative} is not an image (png, jpg, gif, webp, avif). Use read_file for text.`);
  }
  const stat = statSync(absolute);
  if (!stat.isFile()) throw new ProjectAccessError("invalid_argument", `${relative} is not a file`);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new ProjectAccessError("too_large", `${relative} is ${(stat.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB. Ask for a smaller export, or capture the page instead.`);
  }
  return { data: readFileSync(absolute).toString("base64"), mimeType, bytes: stat.size, source: relative };
}

// ---------------------------------------------------------------------------
// Where a capture may point
// ---------------------------------------------------------------------------

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

/** Addresses that must never be reachable through this tool. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  if (version === 6) {
    const value = address.toLowerCase();
    if (value === "::" || value === "::1") return true;
    if (value.startsWith("fe80") || value.startsWith("fc") || value.startsWith("fd")) return true;
    // IPv4-mapped (::ffff:10.0.0.1)
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

function allowedHostList(): string[] {
  return (process.env.OMP_WEB_MCP_CAPTURE_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function hostAllowedByConfig(host: string): boolean {
  const allowed = allowedHostList();
  if (allowed.length === 0) return true; // unset: any public host
  return allowed.some((entry) => (entry.startsWith("*.") ? host.endsWith(entry.slice(1)) : host === entry || host.endsWith(`.${entry}`)));
}

/** Refuse before the browser ever opens: private networks, and hosts the owner excluded. */
async function assertUrlIsCapturable(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProjectAccessError("invalid_argument", `${raw} is not a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProjectAccessError("denied", "Only http and https pages can be captured.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopbackHost(host)) return; // the owner's own dev server

  if (!hostAllowedByConfig(host)) {
    throw new ProjectAccessError("denied", `${host} is not in OMP_WEB_MCP_CAPTURE_HOSTS, so it cannot be captured.`);
  }
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
      throw new ProjectAccessError("not_found", `${host} does not resolve from this machine.`);
    });
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new ProjectAccessError("denied", `${host} resolves to a private address (${address}); only public sites and your own dev server can be captured.`);
    }
  }
}

interface ResolvedTarget {
  url: string;
  label: string;
  /** The saved signed-in session to open this page with, if the owner made one. */
  profileSlug: string | null;
}

/** Only pages on a host the owner personally logged into get that session. */
function sessionFor(rawUrl: string): string | null {
  try {
    return captureProfileForHost(new URL(rawUrl).hostname.toLowerCase())?.slug ?? null;
  } catch {
    return null;
  }
}

async function resolveTarget(project: ConnectorProject, target: string): Promise<ResolvedTarget> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
    await assertUrlIsCapturable(target);
    return { url: target, label: target, profileSlug: sessionFor(target) };
  }
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(target)) {
    // "orcagrade.com/pricing" — a site, written without the scheme.
    const url = `https://${target}`;
    await assertUrlIsCapturable(url);
    return { url, label: url, profileSlug: sessionFor(url) };
  }
  const { absolute, relative } = await resolveReadablePath(project, target);
  if (!/\.x?html?$/i.test(relative)) {
    throw new ProjectAccessError("invalid_argument", `${relative} is not an HTML file. Pass an .html file, a http://localhost:PORT URL, or a site address.`);
  }
  return { url: `file://${absolute}`, label: relative, profileSlug: null };
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export interface CaptureOptions {
  viewport?: unknown;
  width?: unknown;
  height?: unknown;
  fullPage?: unknown;
  waitMs?: unknown;
}

function viewportsFor(options: CaptureOptions): Viewport[] {
  const width = typeof options.width === "number" ? Math.round(options.width) : null;
  const height = typeof options.height === "number" ? Math.round(options.height) : null;
  if (width || height) {
    const clamp = (value: number | null, fallback: number) => Math.min(2000, Math.max(320, value ?? fallback));
    const custom = { name: "custom", width: clamp(width, 1280), height: clamp(height, 900), mobile: clamp(width, 1280) < 768 };
    return [custom];
  }
  const choice = typeof options.viewport === "string" ? options.viewport.toLowerCase() : "desktop";
  if (choice === "both") return [VIEWPORTS.desktop, VIEWPORTS.phone];
  if (choice === "phone" || choice === "mobile") return [VIEWPORTS.phone];
  return [VIEWPORTS.desktop];
}

/**
 * Shoot each group of pages with the browser session it needs: one clean browser
 * for ordinary pages, and one throwaway copy of a saved profile per signed-in
 * host. Results come back in the order asked for, whichever browser took them.
 */
async function captureBySession(
  chrome: string,
  planned: ReadonlyArray<{ request: CaptureRequest; profileSlug: string | null }>,
  options: { fullPage: boolean; waitMs: number },
  notes: string[],
): Promise<Array<{ result: CaptureResult; signedIn: boolean }>> {
  const groups = new Map<string, number[]>();
  planned.forEach((shot, index) => {
    const key = shot.profileSlug ?? "";
    const list = groups.get(key);
    if (list) list.push(index);
    else groups.set(key, [index]);
  });

  const collected = new Array<{ result: CaptureResult; signedIn: boolean } | undefined>(planned.length);
  for (const [slug, indexes] of groups) {
    const requests = indexes.map((index) => planned[index].request);
    let profile: { dir: string; dispose: () => void } | null = null;
    let session: ReturnType<typeof readSavedSession> = null;
    try {
      if (slug) {
        profile = cloneProfileForCapture(slug);
        session = readSavedSession(slug);
        touchCaptureProfile(slug);
      }
    } catch (error) {
      // The saved session is unusable (deleted by hand, a browser still writing
      // the profile). Shoot the pages logged out rather than losing the whole
      // comparison — but say so, because a silently logged-out screenshot is
      // the one failure that looks like a real answer.
      profile = null;
      session = null;
      notes.push(`the saved session for ${slug} could not be used, so these pages were captured logged out: ${error instanceof Error ? error.message : String(error)}`);
    }
    const shots = await captureAll(chrome, requests, {
      fullPage: options.fullPage,
      waitMs: options.waitMs,
      ...(profile ? { profileDir: profile.dir } : {}),
      ...(session ? { session } : {}),
    }).finally(() => profile?.dispose());
    shots.forEach((result, position) => {
      collected[indexes[position]] = { result, signedIn: Boolean(profile) };
    });
  }
  return collected.filter((entry): entry is { result: CaptureResult; signedIn: boolean } => entry !== undefined);
}

/**
 * Screenshot one or more pages. Returns one image per target × viewport, in the
 * order asked for; a page that fails comes back as a note, not an exception, so
 * one dead URL cannot lose the rest of a comparison.
 */
export async function capturePages(
  project: ConnectorProject,
  rawTargets: unknown,
  options: CaptureOptions = {},
): Promise<{ images: CapturedImage[]; notes: string[] }> {
  const list = (Array.isArray(rawTargets) ? rawTargets : [rawTargets])
    .filter((target): target is string => typeof target === "string" && target.trim().length > 0)
    .map((target) => target.trim());
  if (list.length === 0) {
    throw new ProjectAccessError("invalid_argument", "targets is required: HTML files in the project, http://localhost:PORT URLs, or site addresses");
  }
  if (list.length > MAX_TARGETS) {
    throw new ProjectAccessError("invalid_argument", `At most ${MAX_TARGETS} targets per call; split the comparison.`);
  }
  const chrome = resolveChromeBinary();
  if (!chrome) throw new ProjectAccessError("not_found", "No Chrome, Chromium or Edge found on this machine, so pages cannot be captured.");

  const viewports = viewportsFor(options);
  const fullPage = options.fullPage !== false;
  const waitMs = Math.min(10_000, Math.max(0, typeof options.waitMs === "number" ? Math.round(options.waitMs) : 1200));

  const notes: string[] = [];
  const planned: Array<{ request: CaptureRequest; profileSlug: string | null }> = [];
  for (const target of list) {
    let resolved: ResolvedTarget;
    try {
      resolved = await resolveTarget(project, target);
    } catch (error) {
      notes.push(`${target}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const viewport of viewports) {
      planned.push({ request: { url: resolved.url, label: resolved.label, viewport }, profileSlug: resolved.profileSlug });
    }
  }
  if (planned.length === 0) {
    throw new ProjectAccessError("denied", notes.join("; ") || "Nothing could be captured");
  }

  const results = await captureBySession(chrome, planned, { fullPage, waitMs }, notes);

  const images: CapturedImage[] = [];
  let total = 0;
  for (const { result, signedIn } of results) {
    const where = `${result.label} (${result.viewport.name} ${result.viewport.width}px${signedIn ? ", signed in" : ""})`;
    if (result.error) {
      notes.push(`${where}: ${result.error}`);
      continue;
    }
    if (result.png.byteLength > MAX_IMAGE_BYTES || total + result.png.byteLength > MAX_TOTAL_IMAGE_BYTES) {
      notes.push(`${where}: the image is too large to send; capture fewer pages or a narrower viewport.`);
      continue;
    }
    total += result.png.byteLength;
    images.push({ data: result.png.toString("base64"), mimeType: "image/png", bytes: result.png.byteLength, source: where });
  }
  if (images.length === 0) {
    throw new ProjectAccessError("not_found", notes.join("; ") || "Nothing was captured");
  }
  return { images, notes };
}
