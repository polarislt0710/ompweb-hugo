import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BROWSER_URL,
  browserPaneSurface,
  embedPolicyFromHeaders,
  inferBrowserHref,
  inspectBrowserUrl,
  parseAllowlist,
  readBrowserPaneState,
  writeBrowserPaneState,
} from "./browser-pane.ts";

test("allowlists loopback http by default", () => {
  const ok = inspectBrowserUrl("http://127.0.0.1:8120");
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.href, DEFAULT_BROWSER_URL + "/");
    assert.equal(ok.kind, "loopback");
  }
});

test("allows public https sites for in-app iframe attempts", () => {
  const ok = inspectBrowserUrl("https://orcagrade.com/");
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.href, "https://orcagrade.com/");
    assert.equal(ok.kind, "remote");
  }
});

test("rejects javascript urls", () => {
  const blocked = inspectBrowserUrl("javascript:alert(1)");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, "blocked-scheme");
});

test("fills http when the user omits a scheme on localhost", () => {
  const ok = inspectBrowserUrl("localhost:3000");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.href, "http://localhost:3000/");
});

test("fills https when the user omits a scheme on a public host", () => {
  assert.equal(inferBrowserHref("orcagrade.com"), "https://orcagrade.com");
  const ok = inspectBrowserUrl("orcagrade.com");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.href, "https://orcagrade.com/");
});

test("session state round-trips last url and open flag", () => {
  const written = writeBrowserPaneState(null, "sess-1", { url: "http://127.0.0.1:9000", open: true });
  const read = readBrowserPaneState(written, "sess-1");
  assert.equal(read.open, true);
  assert.equal(read.url, "http://127.0.0.1:9000");
  const other = readBrowserPaneState(written, "sess-2");
  assert.equal(other.open, false);
  assert.equal(other.url, DEFAULT_BROWSER_URL);
});

test("parseAllowlist falls back to loopback hosts", () => {
  assert.deepEqual(parseAllowlist(null), ["127.0.0.1", "localhost"]);
  assert.deepEqual(parseAllowlist("[\"localhost\"]"), ["localhost"]);
});

test("remote sites use live Chrome instead of waiting on iframe headers", () => {
  const google = inspectBrowserUrl("https://google.com");
  assert.equal(browserPaneSurface(google, "checking"), "cdp");
  const local = inspectBrowserUrl("http://127.0.0.1:8120");
  assert.equal(browserPaneSurface(local, "allowed"), "iframe");
  assert.equal(browserPaneSurface(local, "checking"), "checking");
  assert.equal(browserPaneSurface(local, "blocked"), "cdp");
  assert.equal(browserPaneSurface(inspectBrowserUrl("javascript:alert(1)"), "allowed"), "fallback");
});

test("embedPolicyFromHeaders blocks X-Frame-Options and tight frame-ancestors", () => {
  const headers = (map) => ({ get: (name) => map[name.toLowerCase()] ?? null });
  assert.equal(embedPolicyFromHeaders(headers({})), "allowed");
  assert.equal(embedPolicyFromHeaders(headers({ "x-frame-options": "DENY" })), "blocked");
  assert.equal(embedPolicyFromHeaders(headers({ "x-frame-options": "sameorigin" })), "blocked");
  assert.equal(embedPolicyFromHeaders(headers({ "content-security-policy": "frame-ancestors 'none'" })), "blocked");
  assert.equal(embedPolicyFromHeaders(headers({ "content-security-policy": "frame-ancestors *" })), "allowed");
  assert.equal(embedPolicyFromHeaders(headers({ "content-security-policy": "default-src 'self'" })), "allowed");
});
