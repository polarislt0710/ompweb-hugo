import { existsSync } from "fs";
import path from "path";

const MAC_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
] as const;

const LINUX_CANDIDATES = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/microsoft-edge",
  "/snap/bin/chromium",
] as const;

export type ChromePathEnv = {
  OMP_WEB_CHROME_BIN?: string;
  PROGRAMFILES?: string;
  "PROGRAMFILES(X86)"?: string;
  LOCALAPPDATA?: string;
  PATH?: string;
  [key: string]: string | undefined;
};

function firstExisting(candidates: readonly string[], exists: (file: string) => boolean): string | null {
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate;
  }
  return null;
}

function windowsCandidates(env: ChromePathEnv): string[] {
  const prefixes = [
    env.LOCALAPPDATA,
    env.PROGRAMFILES,
    env["PROGRAMFILES(X86)"],
  ].filter((value): value is string => Boolean(value));
  const relatives = [
    ["Google", "Chrome", "Application", "chrome.exe"],
    ["Google", "Chrome SxS", "Application", "chrome.exe"],
    ["Chromium", "Application", "chrome.exe"],
    ["Microsoft", "Edge", "Application", "msedge.exe"],
  ];
  return prefixes.flatMap((root) => relatives.map((parts) => path.join(root, ...parts)));
}

function pathLookup(env: ChromePathEnv, names: readonly string[], exists: (file: string) => boolean): string | null {
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/** Locate a system Chrome/Chromium/Edge binary. Never the user's default profile. */
export function resolveChromeBinary(
  env: ChromePathEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = existsSync,
): string | null {
  const override = env.OMP_WEB_CHROME_BIN?.trim();
  if (override) return override;

  if (platform === "darwin") {
    return firstExisting(MAC_CANDIDATES, exists)
      ?? pathLookup(env, ["google-chrome", "chromium", "microsoft-edge"], exists);
  }
  if (platform === "win32") {
    return firstExisting(windowsCandidates(env), exists)
      ?? pathLookup(env, ["chrome.exe", "msedge.exe", "chromium.exe"], exists);
  }
  return firstExisting(LINUX_CANDIDATES, exists)
    ?? pathLookup(env, ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "microsoft-edge"], exists);
}
