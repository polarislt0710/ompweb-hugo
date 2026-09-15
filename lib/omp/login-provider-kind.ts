/**
 * Login providers whose OAuth/session credential unlocks a tool (typically
 * web_search) rather than chat models. Perplexity Pro/Max/Enterprise OAuth is
 * the main case: omp uses the consumer ask endpoint with the subscription
 * cookie. Sonar chat models still need PERPLEXITY_API_KEY and are billed as
 * API usage, not the seat quota.
 */
export const SEARCH_LOGIN_PROVIDER_IDS = new Set(["perplexity"]);

export type LoginProviderKind = "search" | "models";

export function loginProviderKind(id: string): LoginProviderKind {
  return SEARCH_LOGIN_PROVIDER_IDS.has(id) ? "search" : "models";
}

export function isSearchLoginProvider(id: string): boolean {
  return loginProviderKind(id) === "search";
}
