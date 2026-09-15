import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("sidebar drag scales pointer deltas by the interface zoom", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  // clientX is viewport pixels while --sidebar-width is zoomed layout pixels;
  // without the correction the edge overshoots at 110/120% scale.
  assert.match(source, /--ui-scale/);
  assert.match(source, /\(ev\.clientX - startX\) \/ uiScale/);
});

test("interface zoom shrinks the layout box so Settings is not clipped", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /calc\(100dvh \/ var\(--ui-scale, 1\)\)/);
});
