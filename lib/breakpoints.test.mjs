import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { COMPACT_MAX_WIDTH, COMPACT_MEDIA_QUERY, DESKTOP_MEDIA_QUERY, PHONE_MAX_WIDTH } from "./breakpoints.ts";

test("compact breakpoint covers iPad mini and iPad portrait", () => {
  assert.equal(PHONE_MAX_WIDTH, 640);
  assert.equal(COMPACT_MAX_WIDTH, 1023);
  assert.ok(COMPACT_MAX_WIDTH >= 834, "iPad portrait is 820–834 CSS pixels");
  assert.ok(COMPACT_MAX_WIDTH >= 744, "iPad mini portrait is 744 CSS pixels");
  assert.equal(COMPACT_MEDIA_QUERY, "(max-width: 1023px)");
  assert.equal(DESKTOP_MEDIA_QUERY, "(min-width: 1024px)");
});

test("CSS drawer and JS compact query stay on the same cut", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const hook = await readFile(new URL("../hooks/useIsMobile.ts", import.meta.url), "utf8");
  const shell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(hook, /COMPACT_MEDIA_QUERY/);
  assert.match(css, /@media \(max-width: 1023px\) \{/);
  assert.match(css, /@media \(min-width: 1024px\) \{/);
  assert.match(css, /\.sidebar-container \{[\s\S]*position: fixed !important/);
  assert.match(shell, /@media \(max-width: 1023px\) \{/);
});
