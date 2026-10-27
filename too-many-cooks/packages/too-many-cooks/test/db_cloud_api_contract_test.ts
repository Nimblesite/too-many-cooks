/// [CLOUD-API-CONTRACT] Black-box tests for src/db-cloud.ts identity and lock
/// methods against the in-process fake cloud API
/// (test/support/fake_cloud_api.ts). Every TooManyCooksDb method must POST to
/// its 1:1 endpoint with the exact headers/body the Edge Function contract
/// specifies, and parse the Result<T, DbError> JSON envelope back.

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  type CloudContract,
  bindCloudContract,
  requireIndex,
  scriptedOk,
  scriptedVoid,
} from "./support/cloud_contract.js";

const LOCK_TIMEOUT_MS = 30000;

/** Fake cloud API, db-under-test and transport assertion ([CLOUD-API-CONTRACT]). */
const contract: CloudContract = bindCloudContract();
const { assertTransport } = contract;

describe("db-cloud identity endpoint contract", () => {
  it("register posts agentName and parses AgentRegistration", async () => {
    const db = contract.db();
    const value = await scriptedOk(
      contract,
      "register",
      { agent_key: "key-1", agent_name: "alpha" },
      async () => await db.register("alpha"),
      "register failed",
    );
    assert.deepStrictEqual(value, { agentName: "alpha", agentKey: "key-1" });
    assertTransport("register", { agentName: "alpha" });
  });

  it("authenticate posts credentials and parses AgentIdentity", async () => {
    const db = contract.db();
    const value = await scriptedOk(
      contract,
      "authenticate",
      { agent_name: "beta", last_active: 7, registered_at: 5 },
      async () => await db.authenticate("beta", "k"),
      "authenticate failed",
    );
    assert.deepStrictEqual(value, { agentName: "beta", registeredAt: 5, lastActive: 7 });
    assertTransport("authenticate", { agentKey: "k", agentName: "beta" });
  });

  it("lookupByKey returns the agent name; non-string value maps to empty string", async () => {
    const db = contract.db();
    const value = await scriptedOk(
      contract,
      "lookupByKey",
      "beta",
      async () => await db.lookupByKey("k"),
      "lookupByKey failed",
    );
    assert.strictEqual(value, "beta");
    assertTransport("lookupByKey", { agentKey: "k" });

    const fallback = await scriptedOk(
      contract,
      "lookupByKey",
      42,
      async () => await db.lookupByKey("k2"),
      "lookupByKey fallback failed",
    );
    assert.strictEqual(fallback, "");
  });

  it("listAgents maps identity records; non-array value maps to empty list", async () => {
    const db = contract.db();
    const value = await scriptedOk(
      contract,
      "listAgents",
      [
        { agent_name: "a", last_active: 2, registered_at: 1 },
        { agent_name: "b", last_active: 4, registered_at: 3 },
      ],
      async () => await db.listAgents(),
      "listAgents failed",
    );
    assert.deepStrictEqual(value, [
      { agentName: "a", registeredAt: 1, lastActive: 2 },
      { agentName: "b", registeredAt: 3, lastActive: 4 },
    ]);
    assertTransport("listAgents", {});

    const fallback = await scriptedOk(
      contract,
      "listAgents",
      "not-an-array",
      async () => await db.listAgents(),
      "listAgents fallback failed",
    );
    assert.deepStrictEqual(fallback, []);
  });

  it("void lifecycle endpoints pass through success", async () => {
    const db = contract.db();
    await scriptedVoid(contract, "activate", async () => await db.activate("a"), { agentName: "a" });
    await scriptedVoid(contract, "deactivate", async () => await db.deactivate("a"), { agentName: "a" });
    await scriptedVoid(contract, "deactivateAll", async () => await db.deactivateAll(), {});
    await scriptedVoid(contract, "close", async () => await db.close(), {});
  });
});

describe("db-cloud lock endpoint contract", () => {
  it("acquireLock posts full args and parses LockResult", async () => {
    const db = contract.db();
    const value = await scriptedOk(
      contract,
      "acquireLock",
      {
        acquired: true,
        lock: {
          file_path: "/tmp/a.ts", agent_name: "alpha", acquired_at: 10,
          expires_at: 20, reason: "why", version: 3,
        },
      },
      async () => await db.acquireLock("/tmp/a.ts", "alpha", "k", "why", LOCK_TIMEOUT_MS),
      "acquireLock failed",
    );
    assert.deepStrictEqual(value, {
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
    const db = contract.db();
    const none = await scriptedOk(
      contract,
      "queryLock",
      null,
      async () => await db.queryLock("/f"),
      "queryLock failed",
    );
    assert.strictEqual(none, null);
    assertTransport("queryLock", { filePath: "/f" });

    const held = await scriptedOk(
      contract,
      "queryLock",
      { file_path: "/f", agent_name: "z", acquired_at: 1, expires_at: 2, reason: null, version: 9 },
      async () => await db.queryLock("/f"),
      "queryLock held failed",
    );
    assert.deepStrictEqual(held, { filePath: "/f", agentName: "z", acquiredAt: 1, expiresAt: 2, reason: null, version: 9 });

    const defaults = await scriptedOk(
      contract,
      "queryLock",
      {},
      async () => await db.queryLock("/f"),
      "queryLock defaults failed",
    );
    assert.deepStrictEqual(defaults, { filePath: "", agentName: "", acquiredAt: 0, expiresAt: 0, reason: null, version: 0 });
  });

  it("listLocks, release, force-release and renew hit their endpoints", async () => {
    const db = contract.db();
    const locks = await scriptedOk(
      contract,
      "listLocks",
      [{ file_path: "/x", agent_name: "a", acquired_at: 1, expires_at: 2, reason: null, version: 1 }],
      async () => await db.listLocks(),
      "listLocks failed",
    );
    assert.strictEqual(requireIndex(locks, 0, "no locks returned").filePath, "/x");
    assertTransport("listLocks", {});

    await scriptedVoid(
      contract,
      "releaseLock",
      async () => await db.releaseLock("/x", "a", "k"),
      { filePath: "/x", agentName: "a", agentKey: "k" },
    );
    await scriptedVoid(
      contract,
      "forceReleaseLock",
      async () => await db.forceReleaseLock("/x", "a", "k"),
      { filePath: "/x", agentName: "a", agentKey: "k" },
    );
    await scriptedVoid(
      contract,
      "renewLock",
      async () => await db.renewLock("/x", "a", "k", LOCK_TIMEOUT_MS),
      { filePath: "/x", agentName: "a", agentKey: "k", timeoutMs: LOCK_TIMEOUT_MS },
    );
  });
});
