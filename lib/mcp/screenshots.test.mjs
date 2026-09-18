import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { capturePages, isPrivateAddress, readProjectImage, MAX_IMAGE_BYTES } = await jiti.import("./screenshots.ts");

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

test("private and internal addresses are never reachable", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.10", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not-an-ip"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "104.18.32.7", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test("refuses internal hosts, odd schemes and non-HTML files", async (t) => {
  const project = repo(t);
  await assert.rejects(capturePages(project, ["http://192.168.1.10:3000/"]), /private address/);
  await assert.rejects(capturePages(project, ["http://169.254.169.254/latest/meta-data/"]), /private address/);
  await assert.rejects(capturePages(project, ["file:///etc/passwd"]), /http and https/);
  await assert.rejects(capturePages(project, ["ui/notes.md"]), /is not an HTML file/);
  await assert.rejects(capturePages(project, []), /targets is required/);
  await assert.rejects(capturePages(project, ["a.html", "b.html", "c.html", "d.html", "e.html", "f.html", "g.html"]), /At most 6 targets/);
});

test("OMP_WEB_MCP_CAPTURE_HOSTS narrows which sites may be captured", async (t) => {
  const project = repo(t);
  const previous = process.env.OMP_WEB_MCP_CAPTURE_HOSTS;
  process.env.OMP_WEB_MCP_CAPTURE_HOSTS = "orcagrade.com";
  t.after(() => { if (previous === undefined) delete process.env.OMP_WEB_MCP_CAPTURE_HOSTS; else process.env.OMP_WEB_MCP_CAPTURE_HOSTS = previous; });
  await assert.rejects(capturePages(project, ["https://example.com/"]), /not in OMP_WEB_MCP_CAPTURE_HOSTS/);
  // Loopback stays available: it is the owner's own dev server, not a remote host.
  await assert.rejects(capturePages(project, ["http://127.0.0.1:1/"]), /nothing answered|ERR_/i);
});

test("renders project pages at both viewports, full page", async (t) => {
  const project = repo(t);
  const { images } = await capturePages(project, ["ui/mock.html"], { viewport: "both" });
  assert.deepEqual(images.map((shot) => shot.source), ["ui/mock.html (desktop 1280px)", "ui/mock.html (phone 390px)"]);
  for (const shot of images) {
    assert.equal(shot.mimeType, "image/png");
    assert.equal(Buffer.from(shot.data, "base64").subarray(1, 4).toString(), "PNG");
  }
});

test("one dead page does not lose the others", async (t) => {
  const project = repo(t);
  const { images, notes } = await capturePages(project, ["ui/mock.html", "http://127.0.0.1:1/"], { fullPage: false });
  assert.equal(images.length, 1);
  assert.match(notes.join(" "), /127\.0\.0\.1:1/);
});
