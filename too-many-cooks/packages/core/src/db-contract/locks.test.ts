/// Lock acquire, query, renew, and release contract tests.

import { it } from "node:test";
import assert from "node:assert/strict";

import type { AgentRegistration, FileLock, LockResult } from "../types.gen.js";
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  EXPIRED_LOCK_TIMEOUT_MS,
  LONG_LOCK_TIMEOUT_MS,
  SHORT_LOCK_TIMEOUT_MS,
  acquireLockAs,
  acquireLockFor,
  assertError,
  assertLockReleased,
  assertOk,
  cleanupState,
  describeSuite,
  lockSetup,
  registerSecondAgent,
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
    const state: AgentState = getState();
    const lockResult: LockResult = await acquireLockFor(state, "file.ts", DEFAULT_LOCK_TIMEOUT_MS);
    assert.strictEqual(lockResult.acquired, true);

    assertOk(await state.inst.db.releaseLock("file.ts", state.agentName, state.agentKey));

    await assertLockReleased(state.inst, "file.ts");
  });

  it("lock conflict between agents (acquired=false, not error)", async (): Promise<void> => {
    const state: AgentState = getState();
    const reg2: AgentRegistration = await registerSecondAgent(state);
    await acquireLockFor(state, "file.ts", DEFAULT_LOCK_TIMEOUT_MS);

    const conflict: LockResult = await acquireLockAs(state.inst, reg2, "file.ts", DEFAULT_LOCK_TIMEOUT_MS);
    assert.strictEqual(conflict.acquired, false);
  });

  it("acquire fails with invalid credentials", async (): Promise<void> => {
    const state: AgentState = getState();
    assertError(await state.inst.db.acquireLock("file.ts", state.agentName, "wrong", null, DEFAULT_LOCK_TIMEOUT_MS), "UNAUTHORIZED");
  });

  it("expired lock can be taken over by another agent", async (): Promise<void> => {
    const state: AgentState = getState();
    await acquireLockFor(state, "file.ts", EXPIRED_LOCK_TIMEOUT_MS);
    const reg2: AgentRegistration = await registerSecondAgent(state);
    const takeover: LockResult = await acquireLockAs(state.inst, reg2, "file.ts", DEFAULT_LOCK_TIMEOUT_MS);
    assert.strictEqual(takeover.acquired, true);
  });
};

/** Register lock query contract tests. */
const registerLockQueryTests = (getState: () => AgentState): void => {
  it("queryLock returns null for unlocked file", async (): Promise<void> => {
    await assertLockReleased(getState().inst, "unlocked.ts");
  });

  it("queryLock returns lock info", async (): Promise<void> => {
    const state: AgentState = getState();
    await acquireLockFor(state, "file.ts", DEFAULT_LOCK_TIMEOUT_MS, "testing");
    const lock: FileLock | null = unwrap(await state.inst.db.queryLock("file.ts"));
    assert.notStrictEqual(lock, null);
    if (lock) {
      assert.strictEqual(lock.filePath, "file.ts");
      assert.strictEqual(lock.agentName, state.agentName);
      assert.strictEqual(lock.reason, "testing");
    }
  });

  it("listLocks returns all active locks", async (): Promise<void> => {
    const state: AgentState = getState();
    await acquireLockFor(state, "file1.ts", DEFAULT_LOCK_TIMEOUT_MS);
    await acquireLockFor(state, "file2.ts", DEFAULT_LOCK_TIMEOUT_MS);
    const locks: readonly FileLock[] = unwrap(await state.inst.db.listLocks());
    assert.strictEqual(locks.length, 2);
  });
};

/** Register lock renew contract tests. */
const registerLockRenewTests = (getState: () => AgentState): void => {
  it("renew extends lock expiration and increments version", async (): Promise<void> => {
    const state: AgentState = getState();
    await acquireLockFor(state, "file.ts", SHORT_LOCK_TIMEOUT_MS);
    const before: FileLock | null = unwrap(await state.inst.db.queryLock("file.ts"));

    assertOk(await state.inst.db.renewLock("file.ts", state.agentName, state.agentKey, LONG_LOCK_TIMEOUT_MS));

    const after: FileLock | null = unwrap(await state.inst.db.queryLock("file.ts"));
    if (before && after) {
      assert.ok(after.expiresAt > before.expiresAt);
      assert.ok(after.version > before.version);
    }
  });

  it("renew fails when not owned", async (): Promise<void> => {
    const state: AgentState = getState();
    assertError(await state.inst.db.renewLock("file.ts", state.agentName, state.agentKey, DEFAULT_LOCK_TIMEOUT_MS), "NOT_FOUND");
  });
};

/** Register lock release contract tests. */
const registerLockReleaseTests = (getState: () => AgentState): void => {
  it("release fails when not owned", async (): Promise<void> => {
    const state: AgentState = getState();
    assertError(await state.inst.db.releaseLock("file.ts", state.agentName, state.agentKey), "NOT_FOUND");
  });

  it("forceReleaseLock fails on non-expired lock", async (): Promise<void> => {
    const state: AgentState = getState();
    const reg2: AgentRegistration = await registerSecondAgent(state);
    await acquireLockFor(state, "file.ts", DEFAULT_LOCK_TIMEOUT_MS);
    assertError(await state.inst.db.forceReleaseLock("file.ts", reg2.agentName, reg2.agentKey), "LOCK_HELD");
  });

  it("forceReleaseLock fails when no lock exists", async (): Promise<void> => {
    const state: AgentState = getState();
    assertError(await state.inst.db.forceReleaseLock("file.ts", state.agentName, state.agentKey), "NOT_FOUND");
  });
};
