import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "crypto";
import { mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const dir = mkdtempSync(join(tmpdir(), "ompweb-mcp-oauth-"));
process.env.OMP_WEB_PASSWORD = "unit-test-pw";
process.env.OMP_WEB_MCP_BASE_URL = "https://omp.example.com";
process.env.OMP_WEB_MCP_OAUTH_STORE = join(dir, "store.json");
test.after(() => rmSync(dir, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const oauth = await jiti.import("./oauth.ts");
const { safeLoginNext } = await jiti.import("../web-auth.ts");
const { isSecretPath } = await jiti.import("./project-files.ts");

const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";

function authorizeParams(clientId, challenge, extra = {}) {
  return new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s1", ...extra });
}

test("only ChatGPT redirect URIs can be registered", () => {
  assert.equal(oauth.isAllowedRedirectUri(REDIRECT), true);
  assert.equal(oauth.isAllowedRedirectUri("https://chat.openai.com/aip/x/oauth/callback"), true);
  assert.equal(oauth.isAllowedRedirectUri("http://chatgpt.com/cb"), false);
  assert.equal(oauth.isAllowedRedirectUri("https://chatgpt.com.evil.com/cb"), false);
  assert.equal(oauth.isAllowedRedirectUri("https://evilchatgpt.com/cb"), false);
  assert.throws(() => oauth.registerClient({ redirect_uris: ["https://evil.example/cb"] }), oauth.OAuthError);
});

test("authorization code flow with PKCE, rotation, and password-change revocation", async () => {
  const client = oauth.registerClient({ client_name: "ChatGPT", redirect_uris: [REDIRECT] });
  assert.equal(statSync(process.env.OMP_WEB_MCP_OAUTH_STORE).mode & 0o777, 0o600);
  const verifier = randomBytes(40).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  await assert.rejects(oauth.validateAuthorizeRequest(authorizeParams(client.clientId, challenge, { redirect_uri: "https://chatgpt.com/other" })), /not registered/);
  await assert.rejects(oauth.validateAuthorizeRequest(authorizeParams(client.clientId, challenge, { code_challenge_method: "plain" })), /PKCE/);

  const { request } = await oauth.validateAuthorizeRequest(authorizeParams(client.clientId, challenge));
  const token = oauth.consentToken("cookie-a", request);
  assert.equal(oauth.isValidConsentToken(token, "cookie-a", request), true);
  assert.equal(oauth.isValidConsentToken(token, "cookie-b", request), false);

  const code = oauth.issueAuthorizationCode(request);
  const form = (extra) => new URLSearchParams({ grant_type: "authorization_code", code, client_id: client.clientId, redirect_uri: REDIRECT, code_verifier: verifier, ...extra });
  const tokens = await oauth.exchangeToken(form());
  await assert.rejects(oauth.exchangeToken(form()), /invalid or expired/, "codes are single-use");
  assert.deepEqual(oauth.verifyAccessToken(`Bearer ${tokens.access_token}`), { clientId: client.clientId, scope: "omp" });
  assert.equal(oauth.verifyAccessToken(`Bearer ${tokens.refresh_token}`), null, "refresh tokens are not bearer tokens");

  const rotated = await oauth.exchangeToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }));
  await assert.rejects(oauth.exchangeToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token })), /invalid/);

  process.env.OMP_WEB_PASSWORD = "changed-pw";
  assert.equal(oauth.verifyAccessToken(`Bearer ${rotated.access_token}`), null);
  process.env.OMP_WEB_PASSWORD = "unit-test-pw";
  assert.ok(oauth.verifyAccessToken(`Bearer ${rotated.access_token}`));
  oauth.revokeAllAccess();
  assert.equal(oauth.verifyAccessToken(`Bearer ${rotated.access_token}`), null);
});

test("wrong PKCE verifier burns the code", async () => {
  const client = oauth.registerClient({ redirect_uris: [REDIRECT] });
  const challenge = createHash("sha256").update(randomBytes(40).toString("base64url")).digest("base64url");
  const { request } = await oauth.validateAuthorizeRequest(authorizeParams(client.clientId, challenge));
  const code = oauth.issueAuthorizationCode(request);
  await assert.rejects(oauth.exchangeToken(new URLSearchParams({ grant_type: "authorization_code", code, client_id: client.clientId, redirect_uri: REDIRECT, code_verifier: randomBytes(40).toString("base64url") })), /PKCE/);
});

test("login only returns to the connector consent page", () => {
  assert.equal(safeLoginNext("/oauth/authorize?client_id=x"), "/oauth/authorize?client_id=x");
  assert.equal(safeLoginNext("https://evil.example/"), "/");
  assert.equal(safeLoginNext("//evil.example/oauth/authorize?"), "/");
  assert.equal(safeLoginNext("/settings"), "/");
});

test("secret-looking files are never shared", () => {
  for (const path of [".env", "app/.env.local", "certs/server.pem", "deploy/id_ed25519", ".npmrc", "config/service-account-prod.json", ".git/config", "node_modules/x/index.js"]) {
    assert.equal(isSecretPath(path), true, path);
  }
  for (const path of [".env.example", "lib/env.ts", "keys.md", "src/secret-santa.ts"]) {
    assert.equal(isSecretPath(path), false, path);
  }
});
