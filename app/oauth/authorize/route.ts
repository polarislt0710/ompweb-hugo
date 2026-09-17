import { NextResponse, type NextRequest } from "next/server";
import {
  authorizationRedirect,
  consentToken,
  isMcpEnabled,
  isValidConsentToken,
  issueAuthorizationCode,
  mcpBaseUrl,
  OAuthError,
  redirectError,
  validateAuthorizeRequest,
  type AuthorizeRequest,
  type OAuthClient,
} from "@/lib/mcp/oauth";
import { isValidWebSession, OMP_WEB_SESSION_COOKIE } from "@/lib/web-auth";

export const dynamic = "force-dynamic";

const AUTH_PARAMS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title>
<style>
:root{--bg:#f6f5f2;--panel:#fff;--text:#1d1d1b;--muted:#6b6a66;--border:#e2e0da;--accent:#c2571a;--on-accent:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--panel:#1f1f1c;--text:#ecebe6;--muted:#a09e97;--border:#34332f;--accent:#e0783a;--on-accent:#1a1208}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
main{width:min(100%,420px);background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:24px}
h1{font-size:20px;margin:0 0 6px}p{margin:8px 0;color:var(--muted)}ul{margin:10px 0 18px;padding-left:18px}li{margin:4px 0}
code{font-size:12px;word-break:break-all}.row{display:flex;gap:10px;margin-top:18px}
button,a.button{flex:1;min-height:40px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--text);font:600 14px inherit;cursor:pointer;text-align:center;text-decoration:none;display:grid;place-items:center}
button.primary,a.button{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
</style></head><body><main>${body}</main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Leaves the site with a plain navigation: the global CSP form-action 'self' would block a POST redirect to ChatGPT. */
function continueTo(url: string, label: string): NextResponse {
  const safe = escapeHtml(url);
  return page(label, `<meta http-equiv="refresh" content="0;url=${safe}"><h1>${escapeHtml(label)}</h1><p>正在返回 ChatGPT…</p><div class="row"><a class="button" href="${safe}">返回 ChatGPT</a></div>`);
}

function errorPage(error: unknown): NextResponse {
  const redirect = error instanceof OAuthError ? redirectError(error) : null;
  if (redirect) return continueTo(redirect, "授權失敗");
  const message = error instanceof OAuthError ? error.description : "Invalid authorization request";
  return page("授權失敗", `<h1>授權失敗</h1><p>${escapeHtml(message)}</p>`, 400);
}

function consentPage(request: AuthorizeRequest, client: OAuthClient, cookie: string): NextResponse {
  const values: Record<(typeof AUTH_PARAMS)[number], string | null> = {
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    state: request.state,
    scope: request.scope,
    resource: request.resource,
  };
  const hidden = AUTH_PARAMS
    .filter((name) => values[name] !== null)
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(values[name]!)}">`)
    .join("");
  const redirectHost = new URL(request.redirectUri).host;
  return page("連接 OMP Web", `<h1>俾 ${escapeHtml(client.clientName)} 連接 OMP Web？</h1>
<p>授權之後，佢可以：</p>
<ul>
<li>列出專案、讀 code、搜尋、睇 git diff（被 git 忽略嘅檔案同密鑰檔睇唔到）</li>
<li>寫入 <code>.omp/handoff/plan.md</code> 同 <code>decisions.md</code></li>
<li>要求派工或者傳訊息俾工頭（要你喺 OMP Web 批准）</li>
</ul>
<p>佢唔可以直接執行指令或者改原始碼。</p>
<p>授權會傳去：<code>${escapeHtml(redirectHost)}</code></p>
<form method="post" action="${escapeHtml(mcpBaseUrl())}/oauth/authorize">${hidden}<input type="hidden" name="consent_token" value="${escapeHtml(consentToken(cookie, request))}">
<div class="row"><button type="submit" name="decision" value="deny">拒絕</button><button class="primary" type="submit" name="decision" value="allow">允許</button></div></form>`);
}

function loginRedirect(request: NextRequest): NextResponse {
  const next = `/oauth/authorize?${request.nextUrl.searchParams.toString()}`;
  return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, mcpBaseUrl()), 303);
}

export async function GET(request: NextRequest) {
  if (!isMcpEnabled()) return page("Not available", "<h1>未開啟</h1><p>OMP Web 要設定密碼先可以連接 ChatGPT。</p>", 404);
  let validated: Awaited<ReturnType<typeof validateAuthorizeRequest>>;
  try {
    validated = await validateAuthorizeRequest(request.nextUrl.searchParams);
  } catch (error) {
    return errorPage(error);
  }
  const cookie = request.cookies.get(OMP_WEB_SESSION_COOKIE)?.value;
  if (!cookie || !isValidWebSession(cookie)) return loginRedirect(request);
  return consentPage(validated.request, validated.client, cookie);
}

export async function POST(request: NextRequest) {
  if (!isMcpEnabled()) return page("Not available", "<h1>未開啟</h1>", 404);
  const cookie = request.cookies.get(OMP_WEB_SESSION_COOKIE)?.value;
  if (!cookie || !isValidWebSession(cookie)) {
    return page("需要登入", "<h1>需要登入</h1><p>請返回 ChatGPT 重新連接。</p>", 401);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return page("授權失敗", "<h1>授權失敗</h1><p>Invalid form</p>", 400);
  }
  const params = new URLSearchParams();
  for (const name of AUTH_PARAMS) {
    const value = form.get(name);
    if (typeof value === "string") params.set(name, value);
  }
  let validated: Awaited<ReturnType<typeof validateAuthorizeRequest>>;
  try {
    validated = await validateAuthorizeRequest(params);
  } catch (error) {
    return errorPage(error);
  }
  const token = form.get("consent_token");
  if (typeof token !== "string" || !isValidConsentToken(token, cookie, validated.request)) {
    return page("授權失敗", "<h1>授權失敗</h1><p>表單已過期，請返回 ChatGPT 重新連接。</p>", 403);
  }
  if (form.get("decision") !== "allow") {
    const denied = Object.assign(new OAuthError("access_denied", "The owner denied access"), {
      redirectUri: validated.request.redirectUri,
      state: validated.request.state,
    });
    return continueTo(redirectError(denied)!, "已拒絕");
  }
  const code = issueAuthorizationCode(validated.request);
  return continueTo(authorizationRedirect(validated.request, code), "已授權");
}
