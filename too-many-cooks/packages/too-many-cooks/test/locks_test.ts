/// Tests for file lock operations.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ERR_UNAUTHORIZED,
  ERR_NOT_FOUND,
  ERR_LOCK_HELD,
} from "too-many-cooks-core";
import { bindAgentDb } from "./support/db_fixture.js";
import {
  assertFieldSetEquals,
  assertNonNullish,
  expectErr,
  expectOk,
} from "./support/assertions.js";

const TEST_DB_PATH = ".test_locks.db";
const LOCK_TTL_MS = 60000;
const LONG_LOCK_TTL_MS = 600000;

describe("locks", () => {
  const agentDb = bindAgentDb(TEST_DB_PATH, "lock-agent");

  it("acquireLock succeeds on free file", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const lockResult = expectOk(
      await db.acquireLock("/path/to/file.dart", agentName, agentKey, "editing", LOCK_TTL_MS),
      "acquire must be ok",
    );
    assert.strictEqual(lockResult.acquired, true);
    const acquiredLock = assertNonNullish(lockResult.lock, "expected lock");
    assert.strictEqual(acquiredLock.filePath, "/path/to/file.dart");
    assert.strictEqual(acquiredLock.agentName, agentName);
    assert.strictEqual(acquiredLock.reason, "editing");
    assert.strictEqual(lockResult.error, undefined);
  });

  it("acquireLock fails when held by another agent", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    // Register second agent
    const reg2 = expectOk(await db.register("lock-agent-2"), "reg must be ok");

    // First agent acquires lock
    await db.acquireLock("/contested/file.dart", agentName, agentKey, null, LOCK_TTL_MS);

    // Second agent tries to acquire
    const lockResult = expectOk(
      await db.acquireLock("/contested/file.dart", reg2.agentName, reg2.agentKey, null, LOCK_TTL_MS),
      "acquire must be ok",
    );
    assert.strictEqual(lockResult.acquired, false);
    assert.strictEqual(lockResult.lock, undefined);
    const denial = assertNonNullish(lockResult.error, "denied acquire must explain why");
    assert.ok(denial.includes("Held by"));
  });

  it("acquireLock fails with invalid credentials", async () => {
    const db = agentDb.db();
    const { agentName } = agentDb.agent();
    const error = expectErr(
      await db.acquireLock("/path/to/file.dart", agentName, "wrong-key", null, LOCK_TTL_MS),
      "acquire must fail",
    );
    assert.strictEqual(error.code, ERR_UNAUTHORIZED);
  });

  it("releaseLock succeeds when owned", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    await db.acquireLock("/release/file.dart", agentName, agentKey, null, LOCK_TTL_MS);

    const result = await db.releaseLock("/release/file.dart", agentName, agentKey);
    assert.strictEqual(result.ok, true);

    // Verify lock is gone
    const lock = expectOk(await db.queryLock("/release/file.dart"), "query must be ok");
    assert.strictEqual(lock, null);
  });

  it("releaseLock fails when not owned", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const error = expectErr(
      await db.releaseLock("/not/locked.dart", agentName, agentKey),
      "release must fail",
    );
    assert.strictEqual(error.code, ERR_NOT_FOUND);
  });

  it("queryLock returns lock info", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    await db.acquireLock("/query/file.dart", agentName, agentKey, "testing", LOCK_TTL_MS);

    const lock = assertNonNullish(
      expectOk(await db.queryLock("/query/file.dart"), "query must be ok"),
      "expected lock",
    );
    assert.strictEqual(lock.filePath, "/query/file.dart");
    assert.strictEqual(lock.agentName, agentName);
    assert.strictEqual(lock.reason, "testing");
  });

  it("queryLock returns null for unlocked file", async () => {
    const db = agentDb.db();
    const lock = expectOk(await db.queryLock("/not/locked.dart"), "query must be ok");
    assert.strictEqual(lock, null);
  });

  it("listLocks returns all active locks", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    await db.acquireLock("/list/file1.dart", agentName, agentKey, null, LOCK_TTL_MS);
    await db.acquireLock("/list/file2.dart", agentName, agentKey, null, LOCK_TTL_MS);

    const locks = expectOk(await db.listLocks(), "list must be ok");
    assertFieldSetEquals(locks, (l) => l.filePath, ["/list/file1.dart", "/list/file2.dart"]);
  });

  it("renewLock extends expiration", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    await db.acquireLock("/renew/file.dart", agentName, agentKey, null, 1000);

    const lockBefore = assertNonNullish(
      expectOk(await db.queryLock("/renew/file.dart"), "query before must be ok"),
      "expected lock before renew",
    );

    const result = await db.renewLock("/renew/file.dart", agentName, agentKey, LOCK_TTL_MS);
    assert.strictEqual(result.ok, true);

    const lockAfter = assertNonNullish(
      expectOk(await db.queryLock("/renew/file.dart"), "query after must be ok"),
      "expected lock after renew",
    );
    assert.ok(lockAfter.expiresAt > lockBefore.expiresAt);
    assert.ok(lockAfter.version > lockBefore.version);
  });

  it("renewLock fails when not owned", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const error = expectErr(
      await db.renewLock("/not/owned.dart", agentName, agentKey, LOCK_TTL_MS),
      "renew must fail",
    );
    assert.strictEqual(error.code, ERR_NOT_FOUND);
  });

  it("acquireLock takes over expired lock", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    // Acquire with 0ms timeout (immediately expired)
    await db.acquireLock("/expire/file.dart", agentName, agentKey, null, 0);

    // Register second agent
    const reg2 = expectOk(await db.register("lock-agent-3"), "reg must be ok");

    // Second agent should acquire expired lock (expiry checked at acquire time)
    const lockResult = expectOk(
      await db.acquireLock("/expire/file.dart", reg2.agentName, reg2.agentKey, null, LOCK_TTL_MS),
      "acquire must be ok",
    );
    assert.strictEqual(lockResult.acquired, true);
    const acquiredLock = assertNonNullish(lockResult.lock, "expected lock");
    assert.strictEqual(acquiredLock.agentName, reg2.agentName);
  });

  it("forceReleaseLock fails on non-expired lock", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    // Register second agent
    const reg2 = expectOk(await db.register("force-agent"), "reg must be ok");

    // First agent acquires with long timeout
    await db.acquireLock("/force/file.dart", agentName, agentKey, null, LONG_LOCK_TTL_MS);

    // Second agent tries to force release
    const error = expectErr(
      await db.forceReleaseLock("/force/file.dart", reg2.agentName, reg2.agentKey),
      "force release must fail",
    );
    assert.strictEqual(error.code, ERR_LOCK_HELD);
  });

  it("forceReleaseLock fails when no lock exists", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const error = expectErr(
      await db.forceReleaseLock("/no/lock.dart", agentName, agentKey),
      "force release must fail",
    );
    assert.strictEqual(error.code, ERR_NOT_FOUND);
  });
});
