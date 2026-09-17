// Minimal OAuth 2.1 authorization server for the ChatGPT MCP connector.
//
// ChatGPT's custom connectors authenticate with OAuth (authorization code +
// PKCE). The person approving is the ompweb owner: /oauth/authorize requires
// the normal ompweb password session and an explicit Allow click. Clients are
// registered dynamically (RFC 7591) or by a Client ID Metadata Document, and
// redirect URIs are limited to ChatGPT's hosts, so an authorization code can
// only ever be delivered to ChatGPT.
//
// Tokens are random strings; only their SHA-256 is stored, in
// <agentDir>/ompweb-mcp-oauth.json (mode 600). Every token carries a
// fingerprint of the current ompweb password, so changing the password revokes
// all connector access.

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "../omp/paths";

export const MCP_SCOPE = "omp";
export const SUPPORTED_SCOPES = [MCP_SCOPE, "offline_access"] as const;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_CLIENTS = 20;
const MAX_REFRESH_TOKENS = 40;
const DEFAULT_REDIRECT_HOSTS = ["chatgpt.com", "chat.openai.com"];
const CIMD_HOSTS = ["chatgpt.com", "openai.com"];
const MAX_CIMD_BYTES = 64 * 1024;

export class OAuthError extends Error {
  constructor(readonly error: string, readonly description: string, readonly status = 400) {
    super(description);
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function isMcpEnabled(): boolean {
  const password = process.env.OMP_WEB_PASSWORD;
  return typeof password === "string" && password.length > 0 && process.env.OMP_WEB_MCP !== "off";
}

/** Stable public base URL; the tunnel rewrites Host, so it is not derived from requests. */
export function mcpBaseUrl(): string {
  const configured = process.env.OMP_WEB_MCP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = process.env.OMP_WEB_PUBLIC_HOST?.trim() || "omp.bizobot.com";
  return `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
}

export function mcpResourceUrl(): string {
  return `${mcpBaseUrl()}/mcp`;
}

function allowedRedirectHosts(): string[] {
  const extra = (process.env.OMP_WEB_MCP_REDIRECT_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  return [...DEFAULT_REDIRECT_HOSTS, ...extra];
}

function hostMatches(hostname: string, allowed: string): boolean {
  return hostname === allowed || hostname.endsWith(`.${allowed}`);
}

export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === "127.0.0.1" || hostname === "localhost";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) return false;
  return allowedRedirectHosts().some((allowed) => hostMatches(hostname, allowed));
}

function passwordFingerprint(): string {
  return createHmac("sha256", process.env.OMP_WEB_PASSWORD ?? "").update("ompweb-mcp-v1").digest("base64url").slice(0, 16);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  kind: "dcr" | "cimd";
  createdAt: number;
}

interface StoredToken {
  hash: string;
  kind: "access" | "refresh";
  clientId: string;
  scope: string;
  expiresAt: number;
  fingerprint: string;
}

interface OAuthStore {
  version: 1;
  clients: OAuthClient[];
  tokens: StoredToken[];
}

function storePath(): string {
  return process.env.OMP_WEB_MCP_OAUTH_STORE || join(getAgentDir(), "ompweb-mcp-oauth.json");
}

function loadStore(): OAuthStore {
  const path = storePath();
  if (!existsSync(path)) return { version: 1, clients: [], tokens: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<OAuthStore>;
    return {
      version: 1,
      clients: Array.isArray(parsed.clients) ? parsed.clients : [],
      tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
    };
  } catch {
    return { version: 1, clients: [], tokens: [] };
  }
}

function saveStore(store: OAuthStore): void {
  const path = storePath();
  const now = Date.now();
  store.tokens = store.tokens.filter((token) => token.expiresAt > now);
  const refresh = store.tokens.filter((token) => token.kind === "refresh");
  if (refresh.length > MAX_REFRESH_TOKENS) {
    const drop = new Set(refresh.sort((a, b) => a.expiresAt - b.expiresAt).slice(0, refresh.length - MAX_REFRESH_TOKENS).map((token) => token.hash));
    store.tokens = store.tokens.filter((token) => !drop.has(token.hash));
  }
  store.clients = store.clients.slice(-MAX_CLIENTS);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export function protectedResourceMetadata() {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [mcpBaseUrl()],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "OMP Web",
  };
}

export function authorizationServerMetadata() {
  const base = mcpBaseUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...SUPPORTED_SCOPES],
    client_id_metadata_document_supported: true,
  };
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export function registerClient(body: unknown): OAuthClient {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const redirectUris = Array.isArray(record.redirect_uris) ? record.redirect_uris.filter((uri): uri is string => typeof uri === "string") : [];
  if (redirectUris.length === 0 || redirectUris.length > 10) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must list 1-10 URIs");
  }
  const rejected = redirectUris.filter((uri) => !isAllowedRedirectUri(uri));
  if (rejected.length > 0) {
    throw new OAuthError("invalid_redirect_uri", `Redirect URI not allowed: ${rejected[0]}`);
  }
  const method = record.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    throw new OAuthError("invalid_client_metadata", "Only token_endpoint_auth_method \"none\" is supported");
  }
  const client: OAuthClient = {
    clientId: `ompweb-${randomUUID()}`,
    clientName: typeof record.client_name === "string" ? record.client_name.slice(0, 100) : "MCP client",
    redirectUris,
    kind: "dcr",
    createdAt: Date.now(),
  };
  const store = loadStore();
  store.clients.push(client);
  saveStore(store);
  return client;
}

function isCimdClientId(clientId: string): boolean {
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" && url.pathname !== "/" && CIMD_HOSTS.some((host) => hostMatches(url.hostname.toLowerCase(), host));
  } catch {
    return false;
  }
}

declare global {
  var __ompMcpCimdCache: Map<string, { client: OAuthClient; expiresAt: number }> | undefined;
}

async function fetchCimdClient(clientId: string): Promise<OAuthClient> {
  const cache = (globalThis.__ompMcpCimdCache ??= new Map());
  const cached = cache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return cached.client;

  const response = await fetch(clientId, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
  if (!response.ok) throw new OAuthError("invalid_client", `Client metadata document returned HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_CIMD_BYTES) throw new OAuthError("invalid_client", "Client metadata document is too large");
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new OAuthError("invalid_client", "Client metadata document is not JSON");
  }
  if (doc.client_id !== clientId) throw new OAuthError("invalid_client", "Client metadata document client_id mismatch");
  const redirectUris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter((uri): uri is string => typeof uri === "string" && isAllowedRedirectUri(uri)) : [];
  if (redirectUris.length === 0) throw new OAuthError("invalid_client", "Client metadata document has no allowed redirect_uris");
  const client: OAuthClient = {
    clientId,
    clientName: typeof doc.client_name === "string" ? doc.client_name.slice(0, 100) : new URL(clientId).hostname,
    redirectUris,
    kind: "cimd",
    createdAt: Date.now(),
  };
  cache.set(clientId, { client, expiresAt: Date.now() + 10 * 60 * 1000 });
  return client;
}

export async function resolveClient(clientId: string): Promise<OAuthClient> {
  if (!clientId) throw new OAuthError("invalid_client", "client_id is required");
  if (isCimdClientId(clientId)) return fetchCimdClient(clientId);
  const client = loadStore().clients.find((entry) => entry.clientId === clientId);
  if (!client) throw new OAuthError("invalid_client", "Unknown client_id");
  return client;
}

export function listClients(): Array<OAuthClient & { activeTokens: number }> {
  const store = loadStore();
  const now = Date.now();
  const fingerprint = passwordFingerprint();
  const counts = new Map<string, number>();
  for (const token of store.tokens) {
    if (token.kind === "refresh" && token.expiresAt > now && token.fingerprint === fingerprint) {
      counts.set(token.clientId, (counts.get(token.clientId) ?? 0) + 1);
    }
  }
  const clientIds = new Set(store.clients.map((client) => client.clientId));
  const cimd = [...counts.keys()].filter((id) => !clientIds.has(id)).map((clientId): OAuthClient => ({
    clientId, clientName: (() => { try { return new URL(clientId).hostname; } catch { return clientId; } })(), redirectUris: [], kind: "cimd", createdAt: 0,
  }));
  return [...store.clients, ...cimd].map((client) => ({ ...client, activeTokens: counts.get(client.clientId) ?? 0 }));
}

/** Disconnect every connector: all tokens and registered clients are removed. */
export function revokeAllAccess(): void {
  saveStore({ version: 1, clients: [], tokens: [] });
}

// ---------------------------------------------------------------------------
// Authorization request
// ---------------------------------------------------------------------------

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: string;
  resource: string | null;
}

/**
 * Validate an authorization request. Errors thrown before the redirect URI is
 * trusted must be shown to the user, never redirected (open-redirect guard);
 * `redirectable` tells the caller which case it is.
 */
export async function validateAuthorizeRequest(params: URLSearchParams): Promise<{ request: AuthorizeRequest; client: OAuthClient }> {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const client = await resolveClient(clientId);
  if (!redirectUri || !client.redirectUris.includes(redirectUri) || !isAllowedRedirectUri(redirectUri)) {
    throw new OAuthError("invalid_request", "redirect_uri is not registered for this client");
  }
  const state = params.get("state");
  const fail = (error: string, description: string): never => {
    throw Object.assign(new OAuthError(error, description), { redirectUri, state });
  };
  if (params.get("response_type") !== "code") fail("unsupported_response_type", "response_type must be code");
  const codeChallenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    fail("invalid_request", "PKCE with code_challenge_method S256 is required");
  }
  const resource = params.get("resource");
  if (resource && resource.replace(/\/+$/, "") !== mcpResourceUrl() && resource.replace(/\/+$/, "") !== mcpBaseUrl()) {
    fail("invalid_target", "Unknown resource");
  }
  const requested = (params.get("scope") ?? MCP_SCOPE).split(/\s+/).filter(Boolean);
  const unknownScope = requested.find((scope) => !(SUPPORTED_SCOPES as readonly string[]).includes(scope));
  if (unknownScope) fail("invalid_scope", `Unsupported scope: ${unknownScope}`);
  const scope = [...new Set([MCP_SCOPE, ...requested])].join(" ");
  return { request: { clientId, redirectUri, codeChallenge, state, scope, resource }, client };
}

export function redirectError(error: OAuthError & { redirectUri?: string; state?: string | null }): string | null {
  if (!error.redirectUri) return null;
  const url = new URL(error.redirectUri);
  url.searchParams.set("error", error.error);
  url.searchParams.set("error_description", error.description);
  if (error.state) url.searchParams.set("state", error.state);
  url.searchParams.set("iss", mcpBaseUrl());
  return url.toString();
}

/** CSRF token for the consent form, bound to the ompweb session cookie and the request. */
export function consentToken(sessionCookie: string, request: AuthorizeRequest): string {
  return createHmac("sha256", process.env.OMP_WEB_PASSWORD ?? "")
    .update(["consent", sessionCookie, request.clientId, request.redirectUri, request.codeChallenge, request.scope].join("\n"))
    .digest("base64url");
}

export function isValidConsentToken(token: string, sessionCookie: string, request: AuthorizeRequest): boolean {
  return safeEqual(token, consentToken(sessionCookie, request));
}

// ---------------------------------------------------------------------------
// Codes and tokens
// ---------------------------------------------------------------------------

interface PendingCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  expiresAt: number;
}

declare global {
  var __ompMcpCodes: Map<string, PendingCode> | undefined;
}

function codes(): Map<string, PendingCode> {
  return (globalThis.__ompMcpCodes ??= new Map());
}

export function issueAuthorizationCode(request: AuthorizeRequest): string {
  const now = Date.now();
  for (const [key, value] of codes()) if (value.expiresAt <= now) codes().delete(key);
  const code = randomBytes(32).toString("base64url");
  codes().set(sha256(code), {
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scope: request.scope,
    expiresAt: now + CODE_TTL_MS,
  });
  return code;
}

export function authorizationRedirect(request: AuthorizeRequest, code: string): string {
  const url = new URL(request.redirectUri);
  url.searchParams.set("code", code);
  if (request.state) url.searchParams.set("state", request.state);
  url.searchParams.set("iss", mcpBaseUrl());
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function issueTokens(store: OAuthStore, clientId: string, scope: string): TokenResponse {
  const now = Date.now();
  const fingerprint = passwordFingerprint();
  const accessToken = `ompmcp_at_${randomBytes(32).toString("base64url")}`;
  const refreshToken = `ompmcp_rt_${randomBytes(32).toString("base64url")}`;
  store.tokens.push(
    { hash: sha256(accessToken), kind: "access", clientId, scope, expiresAt: now + ACCESS_TOKEN_TTL_MS, fingerprint },
    { hash: sha256(refreshToken), kind: "refresh", clientId, scope, expiresAt: now + REFRESH_TOKEN_TTL_MS, fingerprint },
  );
  saveStore(store);
  return { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_MS / 1000, refresh_token: refreshToken, scope };
}

export async function exchangeToken(form: URLSearchParams): Promise<TokenResponse> {
  const grantType = form.get("grant_type");
  const clientId = form.get("client_id") ?? "";
  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const pending = codes().get(sha256(code));
    codes().delete(sha256(code));
    if (!pending || pending.expiresAt <= Date.now()) throw new OAuthError("invalid_grant", "Authorization code is invalid or expired");
    if (pending.clientId !== clientId) throw new OAuthError("invalid_grant", "client_id does not match the authorization code");
    if (form.get("redirect_uri") !== pending.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri does not match");
    const verifier = form.get("code_verifier") ?? "";
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError("invalid_grant", "code_verifier is invalid");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (!safeEqual(challenge, pending.codeChallenge)) throw new OAuthError("invalid_grant", "PKCE verification failed");
    await resolveClient(clientId);
    return issueTokens(loadStore(), clientId, pending.scope);
  }
  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token") ?? "";
    const store = loadStore();
    const hash = sha256(refreshToken);
    const stored = store.tokens.find((token) => token.hash === hash && token.kind === "refresh");
    if (!stored || stored.expiresAt <= Date.now() || stored.fingerprint !== passwordFingerprint()) {
      throw new OAuthError("invalid_grant", "Refresh token is invalid or expired");
    }
    if (clientId && clientId !== stored.clientId) throw new OAuthError("invalid_grant", "client_id does not match the refresh token");
    // Rotation: a refresh token works once.
    store.tokens = store.tokens.filter((token) => token.hash !== hash);
    return issueTokens(store, stored.clientId, stored.scope);
  }
  throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
}

/** Returns the client id for a valid bearer token, or null. */
export function verifyAccessToken(authorization: string | null): { clientId: string; scope: string } | null {
  if (!authorization || !isMcpEnabled()) return null;
  const match = /^Bearer\s+(ompmcp_at_[A-Za-z0-9_-]{43})$/i.exec(authorization.trim());
  if (!match) return null;
  const hash = sha256(match[1]);
  const token = loadStore().tokens.find((entry) => entry.hash === hash && entry.kind === "access");
  if (!token || token.expiresAt <= Date.now() || token.fingerprint !== passwordFingerprint()) return null;
  return { clientId: token.clientId, scope: token.scope };
}
