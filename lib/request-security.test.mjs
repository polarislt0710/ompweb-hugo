import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./request-security.ts");
}

test("allows same-origin and non-browser API requests", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  assert.equal(isApiRequestOriginAllowed(new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: { origin: "http://localhost:30141", "sec-fetch-site": "same-origin" },
  })), true);
  assert.equal(isApiRequestOriginAllowed(new Request("http://localhost:30141/api/test", { method: "POST" })), true);
});

test("allows a public HTTPS Origin when Cloudflare Tunnel rewrites Host to loopback", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  const previous = process.env.OMP_WEB_PUBLIC_HOST;
  process.env.OMP_WEB_PUBLIC_HOST = "omp.bizobot.com";
  try {
    const request = new Request("http://127.0.0.1:30178/api/web-auth/session", {
      method: "POST",
      headers: {
        host: "127.0.0.1:30178",
        "x-forwarded-proto": "https",
        origin: "https://omp.bizobot.com",
        "sec-fetch-site": "same-origin",
      },
    });
    assert.equal(isApiRequestOriginAllowed(request), true);
  } finally {
    if (previous === undefined) delete process.env.OMP_WEB_PUBLIC_HOST;
    else process.env.OMP_WEB_PUBLIC_HOST = previous;
  }
});

test("still rejects attacker Origin when the tunnel rewrote Host to loopback", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  const previous = process.env.OMP_WEB_PUBLIC_HOST;
  process.env.OMP_WEB_PUBLIC_HOST = "omp.bizobot.com";
  try {
    const request = new Request("http://127.0.0.1:30178/api/web-auth/session", {
      method: "POST",
      headers: {
        host: "127.0.0.1:30178",
        "x-forwarded-proto": "https",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    });
    assert.equal(isApiRequestOriginAllowed(request), false);
  } finally {
    if (previous === undefined) delete process.env.OMP_WEB_PUBLIC_HOST;
    else process.env.OMP_WEB_PUBLIC_HOST = previous;
  }
});

test("allows HTTPS public-host Origin when Next sees an internal HTTP URL", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  const request = new Request("http://127.0.0.1:30178/api/web-auth/session", {
    method: "POST",
    headers: {
      host: "demo.trycloudflare.com",
      "x-forwarded-proto": "https",
      origin: "https://demo.trycloudflare.com",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestOriginAllowed(request), true);
});

test("allows LAN same-origin requests when Next.js uses an internal localhost URL", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  const request = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "192.168.32.7:30141",
      origin: "http://192.168.32.7:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestOriginAllowed(request), true);
});

test("allows a matching Origin even when Sec-Fetch-Site is cross-site", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  assert.equal(isApiRequestOriginAllowed(new Request("http://localhost:30141/api/test", {
    headers: { origin: "http://localhost:30141", "sec-fetch-site": "cross-site" },
  })), true);
});

test("rejects cross-origin browser API requests", async () => {
  const { isApiRequestOriginAllowed, shouldCheckApiRequestOrigin } = await loadSubject();
  const post = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  });
  const crossSiteGet = new Request("http://localhost:30141/api/sessions", {
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(shouldCheckApiRequestOrigin(post), true);
  assert.equal(isApiRequestOriginAllowed(post), false);
  assert.equal(shouldCheckApiRequestOrigin(crossSiteGet), true);
  assert.equal(isApiRequestOriginAllowed(crossSiteGet), false);
});

test("rejects an origin that does not match the external request host", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  const request = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "192.168.32.7:30141",
      origin: "http://attacker.example",
      "sec-fetch-site": "same-site",
    },
  });
  assert.equal(isApiRequestOriginAllowed(request), false);
});
