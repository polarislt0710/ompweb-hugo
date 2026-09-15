import { existsSync } from "fs";
import { join } from "path";
import { DatabaseSync } from "node:sqlite";
import { getAgentDir } from "./paths";

export function getAgentDbPath(): string {
  return join(getAgentDir(), "agent.db");
}

/** Parse omp's auth_credentials.identity_key (e.g. `email:user@host`). Never returns tokens. */
export function parseAuthIdentityKey(identityKey: string | null | undefined): { email?: string } {
  if (!identityKey) return {};
  const trimmed = identityKey.trim();
  if (trimmed.startsWith("email:")) {
    const rest = trimmed.slice("email:".length).trim();
    const email = rest.split("|", 1)[0]?.trim() ?? "";
    return email.includes("@") ? { email } : {};
  }
  if (trimmed.includes("@") && !trimmed.includes(":")) {
    return { email: trimmed };
  }
  return {};
}

/**
 * Read active credential identities from agent.db. Opens read-only and closes
 * immediately so we never hold omp's WAL. Tokens in `data` are not selected.
 */
export function readAuthIdentities(customDbPath?: string): Record<string, { email?: string }> {
  const dbPath = customDbPath ?? getAgentDbPath();
  if (!existsSync(dbPath)) return {};
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(
      "SELECT provider, identity_key FROM auth_credentials WHERE disabled_cause IS NULL AND identity_key IS NOT NULL",
    ).all() as Array<{ provider: string; identity_key: string | null }>;
    const out: Record<string, { email?: string }> = {};
    for (const row of rows) {
      if (typeof row.provider !== "string" || !row.provider) continue;
      const parsed = parseAuthIdentityKey(row.identity_key);
      if (parsed.email) out[row.provider] = parsed;
    }
    return out;
  } catch {
    return {};
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}
