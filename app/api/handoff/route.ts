import { NextRequest, NextResponse } from "next/server";
import { resolveProjectCwd } from "@/lib/api-project-cwd";
import { isExistingFilePathAllowed } from "@/lib/file-access";
import {
  HandoffError,
  isHandoffFileName,
  readHandoffFiles,
  writeHandoffFile,
} from "@/lib/handoff";

export const dynamic = "force-dynamic";

/** GET /api/handoff?cwd=/abs/project — the project's handoff notes. */
export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveProjectCwd(request.nextUrl.searchParams.get("cwd"));
    if ("response" in resolved) return resolved.response;
    return NextResponse.json({ files: readHandoffFiles(resolved.cwd) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

/** PUT /api/handoff { cwd, name, content } — save one handoff file. */
export async function PUT(request: NextRequest) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const resolved = await resolveProjectCwd(record.cwd);
    if ("response" in resolved) return resolved.response;
    if (!isHandoffFileName(record.name)) {
      return NextResponse.json({ error: "Unknown handoff file", code: "invalid_name" }, { status: 400 });
    }
    if (typeof record.content !== "string") {
      return NextResponse.json({ error: "content must be a string", code: "invalid_content" }, { status: 400 });
    }
    const file = writeHandoffFile(resolved.cwd, record.name, record.content, (realDir) =>
      isExistingFilePathAllowed(realDir, resolved.roots),
    );
    return NextResponse.json({ file });
  } catch (error) {
    if (error instanceof HandoffError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "too_large" ? 413 : 403 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
