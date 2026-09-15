import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  CdpBrowserError,
  CdpBrowserHost,
  HIDE_WEBDRIVER_SOURCE,
  buildChromeLaunchArgs,
  cdpWebSocketUrl,
  parseDevToolsActivePort,
  shouldFollowTarget,
} = await jiti.import("./cdp-browser.ts");

test("parses DevToolsActivePort", () => {
  const parsed = parseDevToolsActivePort("9222\n/devtools/browser/abc");
  assert.deepEqual(parsed, { port: 9222, browserPath: "/devtools/browser/abc" });
  assert.equal(parseDevToolsActivePort("nope"), null);
  assert.equal(cdpWebSocketUrl(9222, "/devtools/browser/abc"), "ws://127.0.0.1:9222/devtools/browser/abc");
});

test("Chrome launch args bind loopback and isolate the profile", () => {
  const headed = buildChromeLaunchArgs({ userDataDir: "/tmp/ompweb-cdp" });
  assert.ok(!headed.includes("--headless=new"));
  assert.ok(headed.includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(headed.includes("--remote-debugging-port=0"));
  assert.ok(headed.includes("--disable-blink-features=AutomationControlled"));
  assert.match(HIDE_WEBDRIVER_SOURCE, /webdriver/);
  assert.ok(headed.includes("--user-data-dir=/tmp/ompweb-cdp"));
  const headless = buildChromeLaunchArgs({ userDataDir: "/tmp/x", headed: false });
  assert.ok(headless.includes("--headless=new"));
});

test("popup follow only when the opener is the current page", () => {
  assert.equal(
    shouldFollowTarget({ targetId: "p2", type: "page", openerId: "p1", url: "https://example.com" }, "p1"),
    true,
  );
  assert.equal(
    shouldFollowTarget({ targetId: "p2", type: "page", openerId: "p1" }, "other"),
    false,
  );
  assert.equal(
    shouldFollowTarget({ targetId: "w", type: "worker", openerId: "p1" }, "p1"),
    false,
  );
});

test("ensure throws chrome_not_found without spawning", async () => {
  const host = new CdpBrowserHost({ resolveChrome: () => null, profileDir: "/tmp/ompweb-cdp-test" });
  await assert.rejects(
    () => host.ensure("pane-1", "https://example.com/", 800, 600),
    (error) => {
      assert.ok(error instanceof CdpBrowserError);
      assert.equal(error.code, "chrome_not_found");
      return true;
    },
  );
  await host.dispose();
});
