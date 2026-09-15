/** Viewport metrics from `Page.screencastFrame.metadata`. */
export type ScreencastMetrics = {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
};

export type MappedPoint = { x: number; y: number };

/**
 * Convert a pointer event into canvas layout pixels.
 * `clientX/Y` + `getBoundingClientRect()` stay aligned under CSS `zoom` on `html`;
 * `offsetX/Y` do not (they report unzoomed coordinates, so clicks land too far down).
 */
export function pointerToCanvasOffset(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  clientWidth: number,
  clientHeight: number,
): MappedPoint | null {
  if (rect.width <= 0 || rect.height <= 0 || clientWidth <= 0 || clientHeight <= 0) return null;
  return {
    x: (clientX - rect.left) * (clientWidth / rect.width),
    y: (clientY - rect.top) * (clientHeight / rect.height),
  };
}

/**
 * Map a click on the pane canvas onto CDP CSS viewport coordinates.
 * Default `fill` stretches the JPEG to the canvas (pane-sized viewport).
 */
export function mapCanvasToViewport(input: {
  offsetX: number;
  offsetY: number;
  canvasWidth: number;
  canvasHeight: number;
  imageWidth: number;
  imageHeight: number;
  metrics: ScreencastMetrics | null;
  fit?: "fill" | "contain";
}): MappedPoint | null {
  const { offsetX, offsetY, canvasWidth, canvasHeight, imageWidth, imageHeight } = input;
  if (canvasWidth <= 0 || canvasHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return null;
  const metrics = input.metrics;
  const deviceWidth = metrics?.deviceWidth && metrics.deviceWidth > 0 ? metrics.deviceWidth : imageWidth;
  const deviceHeight = metrics?.deviceHeight && metrics.deviceHeight > 0 ? metrics.deviceHeight : imageHeight;
  const pageScale = metrics?.pageScaleFactor && metrics.pageScaleFactor > 0 ? metrics.pageScaleFactor : 1;
  const fit = input.fit ?? "fill";
  let imgX: number;
  let imgY: number;
  if (fit === "contain") {
    const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
    const drawW = imageWidth * scale;
    const drawH = imageHeight * scale;
    const dx = (canvasWidth - drawW) / 2;
    const dy = (canvasHeight - drawH) / 2;
    if (offsetX < dx || offsetY < dy || offsetX > dx + drawW || offsetY > dy + drawH) return null;
    imgX = (offsetX - dx) / scale;
    imgY = (offsetY - dy) / scale;
  } else {
    imgX = (offsetX / canvasWidth) * imageWidth;
    imgY = (offsetY / canvasHeight) * imageHeight;
  }
  const x = (imgX / imageWidth) * deviceWidth / pageScale;
  const y = (imgY / imageHeight) * deviceHeight / pageScale;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export type CdpModifierBits = number;

export function cdpModifiers(flags: {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): CdpModifierBits {
  return (flags.altKey ? 1 : 0) | (flags.ctrlKey ? 2 : 0) | (flags.metaKey ? 4 : 0) | (flags.shiftKey ? 8 : 0);
}

export type MouseButtonName = "none" | "left" | "middle" | "right" | "back" | "forward";

export function mouseButtonName(button: number): MouseButtonName {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  if (button === 3) return "back";
  if (button === 4) return "forward";
  if (button === 0) return "left";
  return "none";
}

export type CdpMouseType = "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";

export type CdpMouseEvent = {
  type: CdpMouseType;
  x: number;
  y: number;
  button?: MouseButtonName;
  buttons?: number;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  modifiers?: number;
};

export type CdpKeyType = "keyDown" | "keyUp" | "rawKeyDown" | "char";

export type CdpKeyEvent = {
  type: CdpKeyType;
  key?: string;
  code?: string;
  text?: string;
  unmodifiedText?: string;
  modifiers?: number;
  windowsVirtualKeyCode?: number;
};

export type CdpInsertTextEvent = { type: "insertText"; text: string };

export type CdpInputEvent = CdpMouseEvent | CdpKeyEvent | CdpInsertTextEvent;

const PRINTABLE = /^[\u0020-\u007e]$/;

/** Chord that should stay with ompweb / the host browser (new tab, reload, address). */
export function isHostChord(flags: { metaKey?: boolean; ctrlKey?: boolean; key?: string }): boolean {
  if (!flags.metaKey && !flags.ctrlKey) return false;
  const key = (flags.key ?? "").toLowerCase();
  return key.length === 1 && "twrlkfn".includes(key);
}

export function keydownToCdp(input: {
  key: string;
  code: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): CdpKeyEvent[] {
  const modifiers = cdpModifiers(input);
  const printable = PRINTABLE.test(input.key) && !input.ctrlKey && !input.metaKey && !input.altKey;
  const base = {
    key: input.key,
    code: input.code,
    modifiers,
    windowsVirtualKeyCode: windowsKeyCode(input.key, input.code),
  };
  if (printable) {
    const text = input.key;
    // `keyDown` with `text` already inserts; a following `char` would type twice.
    return [
      { ...base, type: "keyDown" },
      { type: "char", text, unmodifiedText: text, modifiers },
    ];
  }
  return [{ ...base, type: "rawKeyDown" }];
}

export function keyupToCdp(input: {
  key: string;
  code: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): CdpKeyEvent {
  return {
    type: "keyUp",
    key: input.key,
    code: input.code,
    modifiers: cdpModifiers(input),
    windowsVirtualKeyCode: windowsKeyCode(input.key, input.code),
  };
}

function windowsKeyCode(key: string, code: string): number | undefined {
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  const named: Record<string, number> = {
    Enter: 13,
    Tab: 9,
    Backspace: 8,
    Escape: 27,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Delete: 46,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
    Space: 32,
  };
  return named[key] ?? named[code];
}

export function clampViewport(width: number, height: number): { width: number; height: number } {
  const w = Math.round(width);
  const h = Math.round(height);
  return {
    width: Math.max(280, Math.min(1920, w > 0 ? w : 400)),
    height: Math.max(200, Math.min(1600, h > 0 ? h : 720)),
  };
}

/** CSS viewport equals the pane so sites reflow (responsive). */
export function desktopLayoutForPane(paneWidth: number, paneHeight: number): { width: number; height: number } {
  return clampViewport(paneWidth, paneHeight);
}

export function clampScreencastScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return Math.max(1, Math.min(2, scale));
}

/** JPEG pixel size for the screencast. Scale 2 on Retina so the pane is not muddy. */
export function screencastFrameSize(
  viewport: { width: number; height: number },
  scale = 1,
): { maxWidth: number; maxHeight: number } {
  const s = clampScreencastScale(scale);
  return {
    maxWidth: Math.max(280, Math.min(1920, Math.round(viewport.width * s))),
    maxHeight: Math.max(200, Math.min(1600, Math.round(viewport.height * s))),
  };
}

export function isCdpSessionId(value: string): boolean {
  return /^[\w.-]{1,128}$/.test(value);
}
