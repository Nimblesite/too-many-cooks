/// Admin operation contract tests: lock/agent deletion, key reset, full reset.

import { it } from "node:test";
import assert from "node:assert/strict";

import type { TooManyCooksDb } from "../db-interface.js";
import type { AgentIdentity, AgentPlan, AgentRegistration, FileLock } from "../types.gen.js";
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  EXPECTED_KEY_LENGTH,
  EXPECTED_MESSAGE_ID_LENGTH,
  assertError,
  cleanupInstance,
  describeSuite,
  freshInstance,
  unwrap,
} from "./setup.test.js";
import type { DbFactory, DbInstance } from "./setup.test.js";

/** Run admin operation contract tests. */
export const runAdminTests = (createTestDb: DbFactory): void => {
  describeSuite(createTestDb, "TooManyCooksDb contract: admin operations", freshInstance, cleanupInstance, (getInst: () => DbInstance): void => {
    registerAdminLockTests(getInst);
    registerAdminAgentTests(getInst);
    registerAdminResetTests(getInst);
  });
};

/** Register admin lock operation contract tests. */
const registerAdminLockTests = (getInst: () => DbInstance): void => {
  it("adminDeleteLock removes lock", async (): Promise<void> => {
    const reg: AgentRegistration = unwrap(await getInst().db.register("agent1"));
    unwrap(await getInst().db.acquireLock("file.ts", reg.agentName, reg.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));

    const del: Awaited<ReturnType<TooManyCooksDb["adminDeleteLock"]>> = await getInst().db.adminDeleteLock("file.ts");
    assert.strictEqual(del.ok, true);

    const query: FileLock | null = unwrap(await getInst().db.queryLock("file.ts"));
    assert.strictEqual(query, null);
  });

  it("adminDeleteLock fails for nonexistent lock", async (): Promise<void> => {
    assertError(await getInst().db.adminDeleteLock("nope.ts"), "NOT_FOUND");
  });
};

/** Register admin agent operation contract tests. */
const registerAdminAgentTests = (getInst: () => DbInstance): void => {
  it("adminDeleteAgent cascades (removes locks, plans, messages)", async (): Promise<void> => {
    const reg: AgentRegistration = unwrap(await getInst().db.register("doomed"));
    const reg2: AgentRegistration = unwrap(await getInst().db.register("other"));
    unwrap(await getInst().db.acquireLock("file.ts", reg.agentName, reg.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
    unwrap(await getInst().db.updatePlan(reg.agentName, reg.agentKey, "goal", "task"));
    unwrap(await getInst().db.sendMessage(reg.agentName, reg.agentKey, reg2.agentName, "hello"));

    const del: Awaited<ReturnType<TooManyCooksDb["adminDeleteAgent"]>> = await getInst().db.adminDeleteAgent("doomed");
    assert.strictEqual(del.ok, true);

    const agents: readonly AgentIdentity[] = unwrap(await getInst().db.listAgents());
    assert.strictEqual(agents.filter((agent: AgentIdentity): boolean => {return agent.agentName === "doomed"}).length, 0);

    const locks: readonly FileLock[] = unwrap(await getInst().db.listLocks());
    assert.strictEqual(locks.filter((lock: FileLock): boolean => {return lock.agentName === "doomed"}).length, 0);

    const plan: AgentPlan | null = unwrap(await getInst().db.getPlan("doomed"));
    assert.strictEqual(plan, null);
  });

  it("adminDeleteAgent fails for nonexistent agent", async (): Promise<void> => {
    assertError(await getInst().db.adminDeleteAgent("ghost"), "NOT_FOUND");
  });

  it("adminSendMessage sends without auth", async (): Promise<void> => {
    unwrap(await getInst().db.register("recipient"));
    const msgId: string = unwrap(await getInst().db.adminSendMessage("system", "recipient", "hello from admin"));
    assert.strictEqual(msgId.length, EXPECTED_MESSAGE_ID_LENGTH);
  });
};

/** Register admin reset operation contract tests. */
const registerAdminResetTests = (getInst: () => DbInstance): void => {
  it("adminResetKey generates new key, invalidates old", async (): Promise<void> => {
    const reg: AgentRegistration = unwrap(await getInst().db.register("agent1"));
    const oldKey: string = reg.agentKey;

    const newReg: AgentRegistration = unwrap(await getInst().db.adminResetKey("agent1"));
    assert.strictEqual(newReg.agentName, "agent1");
    assert.notStrictEqual(newReg.agentKey, oldKey);
    assert.strictEqual(newReg.agentKey.length, EXPECTED_KEY_LENGTH);

    // Old key fails
    assertError(await getInst().db.authenticate("agent1", oldKey), "UNAUTHORIZED");

    // New key works
    const auth: Awaited<ReturnType<TooManyCooksDb["authenticate"]>> = await getInst().db.authenticate("agent1", newReg.agentKey);
    assert.strictEqual(auth.ok, true);
  });

  it("adminResetKey releases locks held by agent", async (): Promise<void> => {
    const reg: AgentRegistration = unwrap(await getInst().db.register("agent1"));
    unwrap(await getInst().db.acquireLock("file.ts", reg.agentName, reg.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));

    unwrap(await getInst().db.adminResetKey("agent1"));

    const lock: FileLock | null = unwrap(await getInst().db.queryLock("file.ts"));
    assert.strictEqual(lock, null);
  });

  it("adminResetKey fails for nonexistent agent", async (): Promise<void> => {
    assertError(await getInst().db.adminResetKey("ghost"), "NOT_FOUND");
  });

  it("adminReset clears transient data but preserves identity", async (): Promise<void> => {
    const reg: AgentRegistration = unwrap(await getInst().db.register("agent1"));
    unwrap(await getInst().db.acquireLock("file.ts", reg.agentName, reg.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
    unwrap(await getInst().db.updatePlan(reg.agentName, reg.agentKey, "goal", "task"));

    unwrap(await getInst().db.adminReset());

    // Transient data cleared
    const locks: readonly FileLock[] = unwrap(await getInst().db.listLocks());
    assert.strictEqual(locks.length, 0);

    const plans: readonly AgentPlan[] = unwrap(await getInst().db.listPlans());
    assert.strictEqual(plans.length, 0);

    // Identity preserved - agent can reconnect with saved key
    const lookup: string = unwrap(await getInst().db.lookupByKey(reg.agentKey));
    assert.strictEqual(lookup, "agent1");
  });
};
