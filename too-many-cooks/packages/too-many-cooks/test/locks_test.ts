/// Tests for file lock operations.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  type FileLock,
  type LockResult,
  type TooManyCooksDb,
  ERR_UNAUTHORIZED,
  ERR_NOT_FOUND,
  ERR_LOCK_HELD,
} from "too-many-cooks-core";
import {
  type AgentActor,
  type RegisteredAgent,
  agentActor,
  bindAgentDb,
  registerAgent,
} from "./support/db_fixture.js";
import {
  assertFieldSetEquals,
  assertNonNullish,
  expectErr,
  expectOk,
} from "./support/assertions.js";

const TEST_DB_PATH = ".test_locks.db";
const LOCK_TTL_MS = 60000;
const LONG_LOCK_TTL_MS = 600000;
const EXPIRED_TTL_MS = 0;

describe("locks", () => {
  const agentDb = bindAgentDb(TEST_DB_PATH, "lock-agent");

  /** Db plus the bound agent's credentials. */
  const actor = (): AgentActor => agentActor(agentDb);

  /** Acquires `file` for `agent`, expecting an Ok LockResult. */
  const acquireFor = async (
    db: TooManyCooksDb,
    file: string,
    agent: RegisteredAgent,
    reason: string | null = null,
    ttlMs: number = LOCK_TTL_MS,
  ): Promise<LockResult> =>
    expectOk(
      await db.acquireLock(file, agent.agentName, agent.agentKey, reason, ttlMs),
      "acquire must be ok",
    );

  /** Reads the lock on `file`, expecting an Ok result. */
  const queryOk = async (
    db: TooManyCooksDb,
    file: string,
    label: string = "query must be ok",
  ): Promise<FileLock | null> => expectOk(await db.queryLock(file), label);

  /** Reads the lock on `file` and asserts it exists. */
  const requireLockOn = async (
    db: TooManyCooksDb,
    file: string,
    label: string,
    queryLabel: string = "query must be ok",
  ): Promise<FileLock> => assertNonNullish(await queryOk(db, file, queryLabel), label);

  it("acquireLock succeeds on free file", async () => {
    const { db, agentName, agentKey } = actor();
    const lockResult = await acquireFor(
      db,
      "/path/to/file.dart",
      { agentName, agentKey },
      "editing",
    );
    assert.strictEqual(lockResult.acquired, true);
    const acquiredLock = assertNonNullish(lockResult.lock, "expected lock");
    assert.strictEqual(acquiredLock.filePath, "/path/to/file.dart");
    assert.strictEqual(acquiredLock.agentName, agentName);
    assert.strictEqual(acquiredLock.reason, "editing");
    assert.strictEqual(lockResult.error, undefined);
  });

  it("acquireLock fails when held by another agent", async () => {
    const { db, agentName, agentKey } = actor();
    const reg2 = await registerAgent(db, "lock-agent-2");

    // First agent acquires lock, second agent tries to acquire
    await acquireFor(db, "/contested/file.dart", { agentName, agentKey });
    const lockResult = await acquireFor(db, "/contested/file.dart", reg2);
    assert.strictEqual(lockResult.acquired, false);
    assert.strictEqual(lockResult.lock, undefined);
    const denial = assertNonNullish(lockResult.error, "denied acquire must explain why");
    assert.ok(denial.includes("Held by"));
  });

  it("acquireLock fails with invalid credentials", async () => {
    const { db, agentName } = actor();
    const error = expectErr(
      await db.acquireLock("/path/to/file.dart", agentName, "wrong-key", null, LOCK_TTL_MS),
      "acquire must fail",
    );
    assert.strictEqual(error.code, ERR_UNAUTHORIZED);
  });

  it("releaseLock succeeds when owned", async () => {
    const { db, agentName, agentKey } = actor();
    await acquireFor(db, "/release/file.dart", { agentName, agentKey });

    const result = await db.releaseLock("/release/file.dart", agentName, agentKey);
    assert.strictEqual(result.ok, true);

    // Verify lock is gone
    const lock = await queryOk(db, "/release/file.dart");
    assert.strictEqual(lock, null);
  });

  it("releaseLock fails when not owned", async () => {
    const { db, agentName, agentKey } = actor();
    const error = expectErr(
      await db.releaseLock("/not/locked.dart", agentName, agentKey),
      "release must fail",
    );
    assert.strictEqual(error.code, ERR_NOT_FOUND);
  });

  it("queryLock returns lock info", async () => {
    const { db, agentName, agentKey } = actor();
    await acquireFor(db, "/query/file.dart", { agentName, agentKey }, "testing");

    const lock = await requireLockOn(db, "/query/file.dart", "expected lock");
    assert.strictEqual(lock.filePath, "/query/file.dart");
    assert.strictEqual(lock.agentName, agentName);
    assert.strictEqual(lock.reason, "testing");
  });

  it("queryLock returns null for unlocked file", async () => {
    const { db } = actor();
    const lock = await queryOk(db, "/not/locked.dart");
    assert.strictEqual(lock, null);
  });

  it("listLocks returns all active locks", async () => {
    const { db, agentName, agentKey } = actor();
    await acquireFor(db, "/list/file1.dart", { agentName, agentKey });
    await acquireFor(db, "/list/file2.dart", { agentName, agentKey });

    const locks = expectOk(await db.listLocks(), "list must be ok");
    assertFieldSetEquals(locks, (l) => l.filePath, ["/list/file1.dart", "/list/file2.dart"]);
  });

  it("renewLock extends expiration", async () => {
    const { db, agentName, agentKey } = actor();
    await acquireFor(db, "/renew/file.dart", { agentName, agentKey }, null, EXPIRED_TTL_MS);

    const lockBefore = await requireLockOn(
      db,
      "/renew/file.dart",
      "expected lock before renew",
      "query before must be ok",
    );

    const result = await db.renewLock("/renew/file.dart", agentName, agentKey, LOCK_TTL_MS);
    assert.strictEqual(result.ok, true);

    const lockAfter = await requireLockOn(
      db,
      "/renew/file.dart",
      "expected lock after renew",
      "query after must be ok",
    );
    assert.ok(lockAfter.expiresAt > lockBefore.expiresAt);
    assert.ok(lockAfter.version > lockBefore.version);
  });

  it("renewLock fails when not owned", async () => {
    const { db, agentName, agentKey } = actor();
    const error = expectErr(
      await db.renewLock("/not/owned.dart", agentName, agentKey, LOCK_TTL_MS),
      "renew must fail",
    );
    assert.strictEqual(error.code, ERR_NOT_FOUND);
  });

  it("acquireLock takes over expired lock", async () => {
    const { db, agentName, agentKey } = actor();
    // Acquire with 0ms timeout (immediately expired)
    await acquireFor(db, "/expire/file.dart", { agentName, agentKey }, null, EXPIRED_TTL_MS);

    const reg2 = await registerAgent(db, "lock-agent-3");

    // Second agent should acquire expired lock (expiry checked at acquire time)
    const lockResult = await acquireFor(db, "/expire/file.dart", reg2);
    assert.strictEqual(lockResult.acquired, true);
    const acquiredLock = assertNonNullish(lockResult.lock, "expected lock");
    assert.strictEqual(acquiredLock.agentName, reg2.agentName);
  });

  it("forceReleaseLock fails on non-expired lock", async () => {
    const { db, agentName, agentKey } = actor();
    const reg2 = await registerAgent(db, "force-agent");

    // First agent acquires with long timeout, second agent tries to force release
    await acquireFor(db, "/force/file.dart", { agentName, agentKey }, null, LONG_LOCK_TTL_MS);
    const error = expectErr(
      await db.forceReleaseLock("/force/file.dart", reg2.agentName, reg2.agentKey),
      "force release must fail",
    );
    assert.strictEqual(error.code, ERR_LOCK_HELD);
  });

  it("forceReleaseLock fails when no lock exists", async () => {
    const { db, agentName, agentKey } = actor();
    const error = expectErr(
      await db.forceReleaseLock("/no/lock.dart", agentName, agentKey),
      "force release must fail",
    );
    assert.strictEqual(error.code, ERR_NOT_FOUND);
  });
});
