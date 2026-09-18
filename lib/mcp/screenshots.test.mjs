import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { capturePage, readProjectImage, MAX_IMAGE_BYTES } = await jiti.import("./screenshots.ts");

// 1x1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-shots-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  mkdirSync(join(dir, "ui"));
  writeFileSync(join(dir, "ui/mock.html"), "<!doctype html><title>t</title><h1>hi</h1>");
  writeFileSync(join(dir, "ui/shot.png"), PNG);
  writeFileSync(join(dir, "ui/notes.md"), "not an image");
  writeFileSync(join(dir, "ui/huge.png"), Buffer.alloc(MAX_IMAGE_BYTES + 1));
  // listConnectorProjects hands out realpaths (macOS /var → /private/var).
  return { name: "shots", path: realpathSync(dir), git: true };
}

test("returns an image file as base64 with its media type", async (t) => {
  const project = repo(t);
  const shot = await readProjectImage(project, "ui/shot.png");
  assert.equal(shot.mimeType, "image/png");
  assert.equal(shot.source, "ui/shot.png");
  assert.equal(Buffer.from(shot.data, "base64").subarray(1, 4).toString(), "PNG");
});

test("refuses non-images, oversized images and paths outside the project", async (t) => {
  const project = repo(t);
  await assert.rejects(readProjectImage(project, "ui/notes.md"), /is not an image/);
  await assert.rejects(readProjectImage(project, "ui/huge.png"), /limit is 4 MB/);
  await assert.rejects(readProjectImage(project, "../../etc/hosts"), /outside the project|not found/i);
});

test("captures only local targets: a project HTML file or a local dev server", async (t) => {
  const project = repo(t);
  for (const target of ["https://example.com/", "http://169.254.169.254/latest/meta-data/", "http://192.168.1.10:3000/", "file:///etc/passwd"]) {
    await assert.rejects(capturePage(project, target), /Only a local dev server/, target);
  }
  await assert.rejects(capturePage(project, "ui/notes.md"), /is not an HTML file/);
  // Nothing is listening here, so the pre-check refuses instead of screenshotting Chrome's error page.
  await assert.rejects(capturePage(project, "http://127.0.0.1:1/"), /Nothing answered/);
});

test("renders a project HTML file to a PNG", async (t) => {
  const project = repo(t);
  // 300 is below the 320 floor, so the viewport comes back clamped.
  const shot = await capturePage(project, "ui/mock.html", { width: 400, height: 300 });
  assert.equal(shot.mimeType, "image/png");
  assert.match(shot.source, /^ui\/mock\.html \(400×320\)$/);
  assert.ok(shot.bytes > 100, "a rendered page is more than a few bytes");
});
