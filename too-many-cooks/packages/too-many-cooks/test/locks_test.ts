/// Tests for file lock operations.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ERR_UNAUTHORIZED,
  ERR_NOT_FOUND,
  ERR_LOCK_HELD,
} from "too-many-cooks-core";
import { bindAgentDb } from "./support/db_fixture.js";

const TEST_DB_PATH = ".test_locks.db";

describe("locks", () => {
  const agentDb = bindAgentDb(TEST_DB_PATH, "lock-agent");

  it("acquireLock succeeds on free file", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const result = await db.acquireLock(
      "/path/to/file.dart",
      agentName,
      agentKey,
      "editing",
      60000,
    );
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const lockResult = result.value;
    assert.strictEqual(lockResult.acquired, true);
    const acquiredLock = lockResult.lock;
    assert.notStrictEqual(acquiredLock, undefined);
    if (acquiredLock === undefined || acquiredLock === null) {throw new Error("expected lock");}
    assert.strictEqual(acquiredLock.filePath, "/path/to/file.dart");
    assert.strictEqual(acquiredLock.agentName, agentName);
    assert.strictEqual(acquiredLock.reason, "editing");
    assert.strictEqual(lockResult.error, undefined);
  });

  it("acquireLock fails when held by another agent", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    // Register second agent
    const reg2Result = await db.register("lock-agent-2");
    if (!reg2Result.ok) {throw new Error("expected ok");}
    const reg2 = reg2Result.value;

    // First agent acquires lock
    await db.acquireLock("/contested/file.dart", agentName, agentKey, null, 60000);

    // Second agent tries to acquire
    const result = await db.acquireLock(
      "/contested/file.dart",
      reg2.agentName,
      reg2.agentKey,
      null,
      60000,
    );
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const lockResult = result.value;
    assert.strictEqual(lockResult.acquired, false);
    assert.strictEqual(lockResult.lock, undefined);
    const denial = lockResult.error;
    assert.ok(denial !== undefined, "denied acquire must explain why");
    assert.ok(denial.includes("Held by"));
  });

  it("acquireLock fails with invalid credentials", async () => {
    const db = agentDb.db();
    const { agentName } = agentDb.agent();
    const result = await db.acquireLock(
      "/path/to/file.dart",
      agentName,
      "wrong-key",
      null,
      60000,
    );
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_UNAUTHORIZED);
  });

  it("releaseLock succeeds when owned", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    await db.acquireLock("/release/file.dart", agentName, agentKey, null, 60000);

    const result = await db.releaseLock("/release/file.dart", agentName, agentKey);
    assert.strictEqual(result.ok, true);

    // Verify lock is gone
    const queryResult = await db.queryLock("/release/file.dart");
    assert.strictEqual(queryResult.ok, true);
    if (!queryResult.ok) {throw new Error("expected ok");}
    const lock = queryResult.value;
    assert.strictEqual(lock, null);
  });

  it("releaseLock fails when not owned", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const result = await db.releaseLock("/not/locked.dart", agentName, agentKey);
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_NOT_FOUND);
  });

  it("queryLock returns lock info", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    await db.acquireLock("/query/file.dart", agentName, agentKey, "testing", 60000);

    const result = await db.queryLock("/query/file.dart");
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const lock = result.value;
    assert.notStrictEqual(lock, undefined);
    if (lock === undefined || lock === null) {throw new Error("expected lock");}
    assert.strictEqual(lock.filePath, "/query/file.dart");
    assert.strictEqual(lock.agentName, agentName);
    assert.strictEqual(lock.reason, "testing");
  });

  it("queryLock returns null for unlocked file", async () => {
    const db = agentDb.db();
    const result = await db.queryLock("/not/locked.dart");
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const lock = result.value;
    assert.strictEqual(lock, null);
  });

  it("listLocks returns all active locks", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    await db.acquireLock("/list/file1.dart", agentName, agentKey, null, 60000);
    await db.acquireLock("/list/file2.dart", agentName, agentKey, null, 60000);

    const result = await db.listLocks();
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const locks = result.value;
    assert.strictEqual(locks.length, 2);
    assert.deepStrictEqual(
      new Set(locks.map((l) => l.filePath)),
      new Set(["/list/file1.dart", "/list/file2.dart"]),
    );
  });

  it("renewLock extends expiration", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    await db.acquireLock("/renew/file.dart", agentName, agentKey, null, 1000);

    const queryBefore = await db.queryLock("/renew/file.dart");
    assert.strictEqual(queryBefore.ok, true);
    if (!queryBefore.ok) {throw new Error("expected ok");}
    const lockBefore = queryBefore.value;
    if (lockBefore === undefined || lockBefore === null) {throw new Error("expected lock before renew");}

    const result = await db.renewLock(
      "/renew/file.dart",
      agentName,
      agentKey,
      60000,
    );
    assert.strictEqual(result.ok, true);

    const queryAfter = await db.queryLock("/renew/file.dart");
    assert.strictEqual(queryAfter.ok, true);
    if (!queryAfter.ok) {throw new Error("expected ok");}
    const lockAfter = queryAfter.value;
    if (lockAfter === undefined || lockAfter === null) {throw new Error("expected lock after renew");}
    assert.ok(lockAfter.expiresAt > lockBefore.expiresAt);
    assert.ok(lockAfter.version > lockBefore.version);
  });

  it("renewLock fails when not owned", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const result = await db.renewLock("/not/owned.dart", agentName, agentKey, 60000);
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_NOT_FOUND);
  });

  it("acquireLock takes over expired lock", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    // Acquire with 0ms timeout (immediately expired)
    await db.acquireLock("/expire/file.dart", agentName, agentKey, null, 0);

    // Register second agent
    const reg2Result = await db.register("lock-agent-3");
    if (!reg2Result.ok) {throw new Error("expected ok");}
    const reg2 = reg2Result.value;

    // Second agent should acquire expired lock (expiry checked at acquire time)
    const result = await db.acquireLock(
      "/expire/file.dart",
      reg2.agentName,
      reg2.agentKey,
      null,
      60000,
    );
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const lockResult = result.value;
    assert.strictEqual(lockResult.acquired, true);
    const acquiredLock = lockResult.lock;
    if (acquiredLock === undefined || acquiredLock === null) {throw new Error("expected lock");}
    assert.strictEqual(acquiredLock.agentName, reg2.agentName);
  });

  it("forceReleaseLock fails on non-expired lock", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    // Register second agent
    const reg2Result = await db.register("force-agent");
    if (!reg2Result.ok) {throw new Error("expected ok");}
    const reg2 = reg2Result.value;

    // First agent acquires with long timeout
    await db.acquireLock("/force/file.dart", agentName, agentKey, null, 600000);

    // Second agent tries to force release
    const result = await db.forceReleaseLock(
      "/force/file.dart",
      reg2.agentName,
      reg2.agentKey,
    );
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_LOCK_HELD);
  });

  it("forceReleaseLock fails when no lock exists", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const result = await db.forceReleaseLock("/no/lock.dart", agentName, agentKey);
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_NOT_FOUND);
  });
});
