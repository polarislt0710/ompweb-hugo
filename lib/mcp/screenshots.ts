// Eyes for the reviewer: hand ChatGPT an image of a screen instead of only the
// markup behind it.
//
// Two sources, both narrow on purpose:
// - an image file already in the project (a design mockup, a saved screenshot);
// - a headless Chrome shot of a page that is already reachable: an HTML file in
//   the project, or a dev server the owner started on this machine.
//
// Nothing here starts a dev server or runs a project command; Chrome is spawned
// with a fixed argument list and a throwaway profile.

import { execFile } from "child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { resolveChromeBinary } from "../chrome-path";
import { ProjectAccessError, resolveReadablePath, type ConnectorProject } from "./project-files";

const execFileAsync = promisify(execFile);

/** ChatGPT has to carry the image in the conversation, so keep it small. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const CAPTURE_TIMEOUT_MS = 45_000;
const MIN_SIDE = 320;
const MAX_SIDE = 2000;

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

export interface CapturedImage {
  /** Base64 for the MCP image content block. */
  data: string;
  mimeType: string;
  bytes: number;
  /** What was captured, for the accompanying text line. */
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

/**
 * Where a capture may point. A local dev server is the owner's own process; any
 * other host would turn the connector into a way to fetch private network pages.
 */
function isAllowedLocalUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

async function resolveTarget(project: ConnectorProject, target: string): Promise<{ url: string; source: string }> {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    if (!isAllowedLocalUrl(target)) {
      throw new ProjectAccessError("denied", "Only a local dev server (localhost or 127.0.0.1) or an HTML file inside the project can be captured.");
    }
    return { url: target, source: target };
  }
  const { absolute, relative } = await resolveReadablePath(project, target);
  if (!/\.x?html?$/i.test(relative)) {
    throw new ProjectAccessError("invalid_argument", `${relative} is not an HTML file. Pass an .html file or a http://localhost:PORT URL.`);
  }
  return { url: `file://${absolute}`, source: relative };
}

function clampSide(value: unknown, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(MAX_SIDE, Math.max(MIN_SIDE, number));
}

/** One-shot headless screenshot. Chrome renders, writes a PNG, and exits. */
export async function capturePage(
  project: ConnectorProject,
  target: unknown,
  options: { width?: unknown; height?: unknown; waitMs?: unknown } = {},
): Promise<CapturedImage> {
  if (typeof target !== "string" || !target.trim()) {
    throw new ProjectAccessError("invalid_argument", "target is required: an HTML file in the project, or a http://localhost:PORT URL");
  }
  const chrome = resolveChromeBinary();
  if (!chrome) throw new ProjectAccessError("not_found", "No Chrome, Chromium or Edge found on this machine, so pages cannot be captured.");

  const { url, source } = await resolveTarget(project, target.trim());
  // Chrome happily screenshots its own "connection refused" page, which reads
  // like a broken UI. Check the server is actually there first.
  if (url.startsWith("http")) {
    try {
      await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000), redirect: "manual" });
    } catch {
      throw new ProjectAccessError("not_found", `Nothing answered at ${url}. Start the dev server on this machine first, then capture again.`);
    }
  }
  const width = clampSide(options.width, 1280);
  const height = clampSide(options.height, 900);
  const waitMs = Math.min(10_000, Math.max(0, typeof options.waitMs === "number" ? Math.round(options.waitMs) : 1200));

  const workDir = mkdtempSync(join(tmpdir(), "ompweb-capture-"));
  const shot = join(workDir, "page.png");
  try {
    await execFileAsync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--hide-scrollbars",
      `--user-data-dir=${join(workDir, "profile")}`,
      `--window-size=${width},${height}`,
      `--virtual-time-budget=${waitMs + 3000}`,
      `--screenshot=${shot}`,
      url,
    ], { timeout: CAPTURE_TIMEOUT_MS, maxBuffer: 1024 * 1024 });

    const stat = statSync(shot);
    if (stat.size > MAX_IMAGE_BYTES) {
      throw new ProjectAccessError("too_large", "The screenshot is too large; capture a smaller viewport.");
    }
    return { data: readFileSync(shot).toString("base64"), mimeType: "image/png", bytes: stat.size, source: `${source} (${width}×${height})` };
  } catch (error) {
    if (error instanceof ProjectAccessError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/.test(message) && !statSafe(shot)) {
      throw new ProjectAccessError("not_found", `Nothing was rendered for ${source}. If it is a dev server, make sure it is running on this machine.`);
    }
    throw new ProjectAccessError("invalid_argument", `Capture failed: ${message.slice(0, 200)}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function statSafe(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
