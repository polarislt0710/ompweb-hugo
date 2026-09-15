import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseAuthIdentityKey, readAuthIdentities } = await jiti.import("./auth-identities.ts");

test("parseAuthIdentityKey reads email: keys and ignores account ids", () => {
  assert.deepEqual(parseAuthIdentityKey("email:work@propertycity.example"), { email: "work@propertycity.example" });
  assert.deepEqual(
    parseAuthIdentityKey("email:hugong0412@gmail.com|org:26645d7d-3b45-4cfe-8702-b6ab1a726d57"),
    { email: "hugong0412@gmail.com" },
  );
  assert.deepEqual(parseAuthIdentityKey("account:0f2a9fd2-1be5-41dd-80e3-2076b95e4f9a"), {});
  assert.deepEqual(parseAuthIdentityKey(null), {});
  assert.deepEqual(parseAuthIdentityKey("email:"), {});
});

test("readAuthIdentities returns emails and never selects credential data", () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-auth-id-"));
  const dbPath = join(dir, "agent.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE auth_credentials (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      data TEXT NOT NULL,
      disabled_cause TEXT,
      identity_key TEXT
    );
  `);
  db.prepare("INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause, identity_key) VALUES (?, ?, ?, ?, ?)").run(
    "perplexity", "oauth", "{\"access\":\"SECRET\"}", null, "email:21226636@life.hkbu.edu.hk",
  );
  db.prepare("INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause, identity_key) VALUES (?, ?, ?, ?, ?)").run(
    "anthropic", "oauth", "{\"access\":\"SECRET\"}", "replaced by newer credential", "email:old@example.com",
  );
  db.close();

  try {
    const identities = readAuthIdentities(dbPath);
    assert.deepEqual(identities, { perplexity: { email: "21226636@life.hkbu.edu.hk" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
