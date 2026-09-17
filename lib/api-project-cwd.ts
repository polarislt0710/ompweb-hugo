import fs from "fs";
import { NextResponse } from "next/server";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "./file-access";

/** Validate a `cwd` from a web API request: absolute, an existing directory, inside the allowed roots. */
export async function resolveProjectCwd(raw: unknown): Promise<{ cwd: string; roots: Set<string> } | { response: NextResponse }> {
  const cwd = typeof raw === "string" ? raw.trim() : "";
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return { response: NextResponse.json({ error: "cwd must be an absolute path", code: "cwd_must_be_absolute" }, { status: 400 }) };
  }
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots)) {
    return { response: NextResponse.json({ error: "Access denied", code: "access_denied" }, { status: 403 }) };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    return { response: NextResponse.json({ error: "Directory not found", code: "directory_not_found" }, { status: 404 }) };
  }
  if (!stat.isDirectory()) {
    return { response: NextResponse.json({ error: "Not a directory", code: "not_a_directory" }, { status: 400 }) };
  }
  if (!isExistingFilePathAllowed(cwd, roots)) {
    return { response: NextResponse.json({ error: "Access denied", code: "access_denied" }, { status: 403 }) };
  }
  return { cwd, roots };
}
