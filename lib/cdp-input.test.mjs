import test from "node:test";
import assert from "node:assert/strict";
import {
  clampScreencastScale,
  clampViewport,
  desktopLayoutForPane,
  cdpModifiers,
  isCdpSessionId,
  isHostChord,
  keydownToCdp,
  mapCanvasToViewport,
  mouseButtonName,
  pointerToCanvasOffset,
  screencastFrameSize,
} from "./cdp-input.ts";

test("fill-maps a click on the stretched frame to CSS viewport coordinates", () => {
  const point = mapCanvasToViewport({
    offsetX: 100,
    offsetY: 50,
    canvasWidth: 200,
    canvasHeight: 200,
    imageWidth: 800,
    imageHeight: 400,
    metrics: { offsetTop: 0, pageScaleFactor: 1, deviceWidth: 400, deviceHeight: 800 },
  });
  assert.deepEqual(point, { x: 200, y: 200 });
});

test("undoes CSS zoom so a click is not shifted down", () => {
  const local = pointerToCanvasOffset(240, 240, { left: 0, top: 0, width: 480, height: 960 }, 400, 800);
  assert.deepEqual(local, { x: 200, y: 200 });
});

test("ignores clicks in the letterbox when fit is contain", () => {
  const point = mapCanvasToViewport({
    offsetX: 5,
    offsetY: 100,
    canvasWidth: 400,
    canvasHeight: 200,
    imageWidth: 200,
    imageHeight: 200,
    metrics: { offsetTop: 0, pageScaleFactor: 1, deviceWidth: 200, deviceHeight: 200 },
    fit: "contain",
  });
  assert.equal(point, null);
});

test("keydown of a letter emits keyDown without text plus a single char", () => {
  const events = keydownToCdp({ key: "a", code: "KeyA" });
  assert.equal(events[0]?.type, "keyDown");
  assert.equal(events[0]?.text, undefined);
  assert.equal(events[1]?.type, "char");
  assert.equal(events[1]?.text, "a");
});

test("Enter is rawKeyDown without a char", () => {
  const events = keydownToCdp({ key: "Enter", code: "Enter" });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "rawKeyDown");
});

test("host chords stay with ompweb", () => {
  assert.equal(isHostChord({ metaKey: true, key: "r" }), true);
  assert.equal(isHostChord({ ctrlKey: true, key: "t" }), true);
  assert.equal(isHostChord({ key: "a" }), false);
});

test("modifier bits match CDP Alt/Ctrl/Meta/Shift", () => {
  assert.equal(cdpModifiers({ altKey: true, shiftKey: true }), 9);
  assert.equal(mouseButtonName(2), "right");
});

test("viewport clamp follows a tall pane instead of forcing landscape", () => {
  assert.deepEqual(clampViewport(420, 1000), { width: 420, height: 1000 });
  assert.deepEqual(clampViewport(80, 9000), { width: 280, height: 1600 });
  assert.deepEqual(clampViewport(0, 0), { width: 400, height: 720 });
  assert.equal(isCdpSessionId("sess-1"), true);
  assert.equal(isCdpSessionId("bad id"), false);
  assert.equal(isCdpSessionId(""), false);
  assert.equal(clampScreencastScale(3), 2);
  assert.deepEqual(screencastFrameSize({ width: 400, height: 800 }, 2), { maxWidth: 800, maxHeight: 1600 });
});

test("desktop layout matches the pane so the page can reflow", () => {
  assert.deepEqual(desktopLayoutForPane(420, 1000), { width: 420, height: 1000 });
  assert.deepEqual(desktopLayoutForPane(1280, 800), { width: 1280, height: 800 });
});
