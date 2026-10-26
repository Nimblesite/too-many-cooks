/// [CLOUD-API-CONTRACT] Black-box tests for src/db-cloud.ts identity and lock
/// methods against the in-process fake cloud API
/// (test/support/fake_cloud_api.ts). Every TooManyCooksDb method must POST to
/// its 1:1 endpoint with the exact headers/body the Edge Function contract
/// specifies, and parse the Result<T, DbError> JSON envelope back.

import { after, before, describe, it } from "node:test";
import assert from "node:assert";

import { createCloudDb } from "../src/db-cloud.js";
import { FakeCloudApi, okEnvelope } from "./support/fake_cloud_api.js";

const API_KEY = "test-api-key-123";
const WORKSPACE_ID = "ws-42";
const BEARER = `Bearer ${API_KEY}`;
const LOCK_TIMEOUT_MS = 30000;
const MSG_HEADER_CONTENT = "application/json";

const cloud = new FakeCloudApi();

/** The db under test, created in `before`. */
let db: ReturnType<typeof createCloudDb> | undefined;

before(async () => {
  const url: string = await cloud.start();
  db = createCloudDb(url, API_KEY, WORKSPACE_ID);
});

after(async () => {
  await cloud.close();
});

/** Assert the transport contract on the most recent recorded call. */
const assertTransport = (endpoint: string, expectedBody: unknown): void => {
  const req = cloud.last(endpoint);
  assert.strictEqual(req.httpMethod, "POST");
  assert.strictEqual(req.headers.authorization, BEARER);
  assert.strictEqual(req.headers["x-workspace-id"], WORKSPACE_ID);
  assert.strictEqual(req.headers["content-type"], MSG_HEADER_CONTENT);
  assert.deepStrictEqual(req.body, expectedBody);
};

describe("db-cloud identity endpoint contract", () => {
  it("register posts agentName and parses AgentRegistration", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    cloud.script("register", 200, okEnvelope({ agent_name: "alpha", agent_key: "key-1" }));
    const result = await db.register("alpha");
    if (!result.ok) { assert.fail(`register failed: ${JSON.stringify(result.error)}`); }
    assert.deepStrictEqual(result.value, { agentName: "alpha", agentKey: "key-1" });
    assertTransport("register", { agentName: "alpha" });
  });

  it("authenticate posts credentials and parses AgentIdentity", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    cloud.script("authenticate", 200, okEnvelope({ agent_name: "beta", registered_at: 5, last_active: 7 }));
    const result = await db.authenticate("beta", "k");
    if (!result.ok) { assert.fail("authenticate failed"); }
    assert.deepStrictEqual(result.value, { agentName: "beta", registeredAt: 5, lastActive: 7 });
    assertTransport("authenticate", { agentName: "beta", agentKey: "k" });
  });

  it("lookupByKey returns the agent name; non-string value maps to empty string", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    cloud.script("lookupByKey", 200, okEnvelope("beta"));
    const result = await db.lookupByKey("k");
    if (!result.ok) { assert.fail("lookupByKey failed"); }
    assert.strictEqual(result.value, "beta");
    assertTransport("lookupByKey", { agentKey: "k" });

    cloud.script("lookupByKey", 200, okEnvelope(42));
    const fallback = await db.lookupByKey("k2");
    if (!fallback.ok) { assert.fail("lookupByKey fallback failed"); }
    assert.strictEqual(fallback.value, "");
  });

  it("listAgents maps identity records; non-array value maps to empty list", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    cloud.script("listAgents", 200, okEnvelope([
      { agent_name: "a", registered_at: 1, last_active: 2 },
      { agent_name: "b", registered_at: 3, last_active: 4 },
    ]));
    const result = await db.listAgents();
    if (!result.ok) { assert.fail("listAgents failed"); }
    assert.deepStrictEqual(result.value, [
      { agentName: "a", registeredAt: 1, lastActive: 2 },
      { agentName: "b", registeredAt: 3, lastActive: 4 },
    ]);
    assertTransport("listAgents", {});

    cloud.script("listAgents", 200, okEnvelope("not-an-array"));
    const fallback = await db.listAgents();
    if (!fallback.ok) { assert.fail("listAgents fallback failed"); }
    assert.deepStrictEqual(fallback.value, []);
  });

  it("void lifecycle endpoints pass through success", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    cloud.script("activate", 200, okEnvelope(null));
    const activate = await db.activate("a");
    assert.strictEqual(activate.ok, true);
    assertTransport("activate", { agentName: "a" });

    cloud.script("deactivate", 200, okEnvelope(null));
    const deactivate = await db.deactivate("a");
    assert.strictEqual(deactivate.ok, true);
    assertTransport("deactivate", { agentName: "a" });

    cloud.script("deactivateAll", 200, okEnvelope(null));
    const deactivateAll = await db.deactivateAll();
    assert.strictEqual(deactivateAll.ok, true);
    assertTransport("deactivateAll", {});

    cloud.script("close", 200, okEnvelope(null));
    const close = await db.close();
    assert.strictEqual(close.ok, true);
    assertTransport("close", {});
  });
});

describe("db-cloud lock endpoint contract", () => {
  it("acquireLock posts full args and parses LockResult", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    cloud.script("acquireLock", 200, okEnvelope({
      acquired: true,
      lock: {
        file_path: "/tmp/a.ts", agent_name: "alpha", acquired_at: 10,
        expires_at: 20, reason: "why", version: 3,
      },
    }));
    const result = await db.acquireLock("/tmp/a.ts", "alpha", "k", "why", LOCK_TIMEOUT_MS);
    if (!result.ok) { assert.fail("acquireLock failed"); }
    assert.deepStrictEqual(result.value, {
      acquired: true,
      lock: {
        filePath: "/tmp/a.ts", agentName: "alpha", acquiredAt: 10,
        expiresAt: 20, reason: "why", version: 3,
      },
      error: undefined,
    });
    assertTransport("acquireLock", {
      filePath: "/tmp/a.ts", agentName: "alpha", agentKey: "k",
      reason: "why", timeoutMs: LOCK_TIMEOUT_MS,
    });
  });

  it("queryLock maps null, records and default-filled locks", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    cloud.script("queryLock", 200, okEnvelope(null));
    const none = await db.queryLock("/f");
    if (!none.ok) { assert.fail("queryLock failed"); }
    assert.strictEqual(none.value, null);
    assertTransport("queryLock", { filePath: "/f" });

    cloud.script("queryLock", 200, okEnvelope({ file_path: "/f", agent_name: "z", acquired_at: 1, expires_at: 2, reason: null, version: 9 }));
    const held = await db.queryLock("/f");
    if (!held.ok) { assert.fail("queryLock held failed"); }
    assert.deepStrictEqual(held.value, { filePath: "/f", agentName: "z", acquiredAt: 1, expiresAt: 2, reason: null, version: 9 });

    cloud.script("queryLock", 200, okEnvelope({}));
    const defaults = await db.queryLock("/f");
    if (!defaults.ok) { assert.fail("queryLock defaults failed"); }
    assert.deepStrictEqual(defaults.value, { filePath: "", agentName: "", acquiredAt: 0, expiresAt: 0, reason: null, version: 0 });
  });

  it("listLocks, release, force-release and renew hit their endpoints", async () => {
    if (db === undefined) { assert.fail("db not created"); }
    cloud.script("listLocks", 200, okEnvelope([{ file_path: "/x", agent_name: "a", acquired_at: 1, expires_at: 2, reason: null, version: 1 }]));
    const locks = await db.listLocks();
    if (!locks.ok) { assert.fail("listLocks failed"); }
    const firstLock = locks.value[0];
    if (firstLock === undefined) { assert.fail("no locks returned"); }
    assert.strictEqual(firstLock.filePath, "/x");
    assertTransport("listLocks", {});

    cloud.script("releaseLock", 200, okEnvelope(null));
    const rel = await db.releaseLock("/x", "a", "k");
    assert.strictEqual(rel.ok, true);
    assertTransport("releaseLock", { filePath: "/x", agentName: "a", agentKey: "k" });

    cloud.script("forceReleaseLock", 200, okEnvelope(null));
    const forced = await db.forceReleaseLock("/x", "a", "k");
    assert.strictEqual(forced.ok, true);
    assertTransport("forceReleaseLock", { filePath: "/x", agentName: "a", agentKey: "k" });

    cloud.script("renewLock", 200, okEnvelope(null));
    const renewed = await db.renewLock("/x", "a", "k", LOCK_TIMEOUT_MS);
    assert.strictEqual(renewed.ok, true);
    assertTransport("renewLock", { filePath: "/x", agentName: "a", agentKey: "k", timeoutMs: LOCK_TIMEOUT_MS });
  });
});
