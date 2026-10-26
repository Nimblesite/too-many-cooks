/// Lock acquire, query, renew, and release contract tests.

import { it } from "node:test";
import assert from "node:assert/strict";

import type { TooManyCooksDb } from "../db-interface.js";
import type { AgentRegistration, FileLock, LockResult } from "../types.gen.js";
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  EXPIRED_LOCK_TIMEOUT_MS,
  LONG_LOCK_TIMEOUT_MS,
  SHORT_LOCK_TIMEOUT_MS,
  assertError,
  cleanupState,
  describeSuite,
  lockSetup,
  unwrap,
} from "./setup.test.js";
import type { AgentState, DbFactory } from "./setup.test.js";

/** Register lock contract tests. */
export const runLockTests = (createTestDb: DbFactory): void => {
  describeSuite(createTestDb, "TooManyCooksDb contract: locks", lockSetup, cleanupState, (getState: () => AgentState): void => {
    registerLockAcquireTests(getState);
    registerLockQueryTests(getState);
    registerLockRenewTests(getState);
    registerLockReleaseTests(getState);
  });
};

/** Register lock acquire/conflict contract tests. */
const registerLockAcquireTests = (getState: () => AgentState): void => {
  it("acquire and release lock", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    const lockResult: LockResult = unwrap(await inst.db.acquireLock("file.ts", agentName, agentKey, "editing", DEFAULT_LOCK_TIMEOUT_MS));
    assert.strictEqual(lockResult.acquired, true);

    const release: Awaited<ReturnType<TooManyCooksDb["releaseLock"]>> = await inst.db.releaseLock("file.ts", agentName, agentKey);
    assert.strictEqual(release.ok, true);

    const query: FileLock | null = unwrap(await inst.db.queryLock("file.ts"));
    assert.strictEqual(query, null);
  });

  it("lock conflict between agents (acquired=false, not error)", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    const reg2: AgentRegistration = unwrap(await inst.db.register("agent2"));
    unwrap(await inst.db.acquireLock("file.ts", agentName, agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));

    const conflict: LockResult = unwrap(await inst.db.acquireLock("file.ts", reg2.agentName, reg2.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
    assert.strictEqual(conflict.acquired, false);
  });

  it("acquire fails with invalid credentials", async (): Promise<void> => {
    const { inst, agentName } = getState();
    assertError(await inst.db.acquireLock("file.ts", agentName, "wrong", null, DEFAULT_LOCK_TIMEOUT_MS), "UNAUTHORIZED");
  });

  it("expired lock can be taken over by another agent", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    unwrap(await inst.db.acquireLock("file.ts", agentName, agentKey, null, EXPIRED_LOCK_TIMEOUT_MS));
    const reg2: AgentRegistration = unwrap(await inst.db.register("agent2"));
    const takeover: LockResult = unwrap(await inst.db.acquireLock("file.ts", reg2.agentName, reg2.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
    assert.strictEqual(takeover.acquired, true);
  });
};

/** Register lock query contract tests. */
const registerLockQueryTests = (getState: () => AgentState): void => {
  it("queryLock returns null for unlocked file", async (): Promise<void> => {
    const query: FileLock | null = unwrap(await getState().inst.db.queryLock("unlocked.ts"));
    assert.strictEqual(query, null);
  });

  it("queryLock returns lock info", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    unwrap(await inst.db.acquireLock("file.ts", agentName, agentKey, "testing", DEFAULT_LOCK_TIMEOUT_MS));
    const lock: FileLock | null = unwrap(await inst.db.queryLock("file.ts"));
    assert.notStrictEqual(lock, null);
    if (lock) {
      assert.strictEqual(lock.filePath, "file.ts");
      assert.strictEqual(lock.agentName, agentName);
      assert.strictEqual(lock.reason, "testing");
    }
  });

  it("listLocks returns all active locks", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    unwrap(await inst.db.acquireLock("file1.ts", agentName, agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
    unwrap(await inst.db.acquireLock("file2.ts", agentName, agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
    const locks: readonly FileLock[] = unwrap(await inst.db.listLocks());
    assert.strictEqual(locks.length, 2);
  });
};

/** Register lock renew contract tests. */
const registerLockRenewTests = (getState: () => AgentState): void => {
  it("renew extends lock expiration and increments version", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    unwrap(await inst.db.acquireLock("file.ts", agentName, agentKey, null, SHORT_LOCK_TIMEOUT_MS));
    const before: FileLock | null = unwrap(await inst.db.queryLock("file.ts"));

    const renew: Awaited<ReturnType<TooManyCooksDb["renewLock"]>> = await inst.db.renewLock("file.ts", agentName, agentKey, LONG_LOCK_TIMEOUT_MS);
    assert.strictEqual(renew.ok, true);

    const after: FileLock | null = unwrap(await inst.db.queryLock("file.ts"));
    if (before && after) {
      assert.ok(after.expiresAt > before.expiresAt);
      assert.ok(after.version > before.version);
    }
  });

  it("renew fails when not owned", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    assertError(await inst.db.renewLock("file.ts", agentName, agentKey, DEFAULT_LOCK_TIMEOUT_MS), "NOT_FOUND");
  });
};

/** Register lock release contract tests. */
const registerLockReleaseTests = (getState: () => AgentState): void => {
  it("release fails when not owned", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    assertError(await inst.db.releaseLock("file.ts", agentName, agentKey), "NOT_FOUND");
  });

  it("forceReleaseLock fails on non-expired lock", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    const reg2: AgentRegistration = unwrap(await inst.db.register("agent2"));
    unwrap(await inst.db.acquireLock("file.ts", agentName, agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
    assertError(await inst.db.forceReleaseLock("file.ts", reg2.agentName, reg2.agentKey), "LOCK_HELD");
  });

  it("forceReleaseLock fails when no lock exists", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    assertError(await inst.db.forceReleaseLock("file.ts", agentName, agentKey), "NOT_FOUND");
  });
};
