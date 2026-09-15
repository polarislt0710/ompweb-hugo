import test from "node:test";
import assert from "node:assert/strict";
import { resolveChromeBinary } from "./chrome-path.ts";

test("honors OMP_WEB_CHROME_BIN when the file exists", () => {
  const found = resolveChromeBinary(
    { OMP_WEB_CHROME_BIN: "/opt/custom-chrome" },
    "darwin",
    (file) => file === "/opt/custom-chrome",
  );
  assert.equal(found, "/opt/custom-chrome");
});

test("uses macOS application paths before PATH", () => {
  const found = resolveChromeBinary(
    { PATH: "/usr/bin" },
    "darwin",
    (file) => file === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  );
  assert.equal(found, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
});

test("finds Windows Chrome under LOCALAPPDATA", () => {
  const found = resolveChromeBinary(
    { LOCALAPPDATA: "C:\\Users\\hugo\\AppData\\Local" },
    "win32",
    (file) => file.replaceAll("/", "\\").endsWith("Chrome\\Application\\chrome.exe"),
  );
  assert.ok(found?.includes("chrome.exe"));
});

test("returns null when nothing exists", () => {
  assert.equal(resolveChromeBinary({ PATH: "" }, "linux", () => false), null);
});
