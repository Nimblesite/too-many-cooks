/// Admin operation contract tests: lock/agent deletion, key reset, full reset.

import { it } from "node:test";
import assert from "node:assert/strict";

import type { AgentRegistration } from "../types.gen.js";
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  EXPECTED_KEY_LENGTH,
  EXPECTED_MESSAGE_ID_LENGTH,
  acquireLockAs,
  assertError,
  assertKeyBelongsTo,
  assertLockReleased,
  assertOk,
  cleanupInstance,
  describeSuite,
  freshInstance,
  registerAgent,
  registerAndAcquireLock,
  registerPair,
  unwrap,
} from "./setup.test.js";
import type { DbFactory, DbInstance } from "./setup.test.js";

/** Assert no collection entry belongs to `agentName`. */
const assertNoAgentEntries = <T extends { readonly agentName: string }>(
  entries: readonly T[],
  agentName: string,
): void => {
  assert.strictEqual(entries.filter((entry: T): boolean => {return entry.agentName === agentName}).length, 0);
};

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
    await registerAndAcquireLock(getInst(), "agent1", "file.ts");

    assertOk(await getInst().db.adminDeleteLock("file.ts"));

    await assertLockReleased(getInst(), "file.ts");
  });

  it("adminDeleteLock fails for nonexistent lock", async (): Promise<void> => {
    assertError(await getInst().db.adminDeleteLock("nope.ts"), "NOT_FOUND");
  });
};

/** Register admin agent operation contract tests. */
const registerAdminAgentTests = (getInst: () => DbInstance): void => {
  it("adminDeleteAgent cascades (removes locks, plans, messages)", async (): Promise<void> => {
    const [reg, reg2]: readonly [AgentRegistration, AgentRegistration] = await registerPair(getInst(), "doomed", "other");
    await acquireLockAs(getInst(), reg, "file.ts", DEFAULT_LOCK_TIMEOUT_MS);
    unwrap(await getInst().db.updatePlan(reg.agentName, reg.agentKey, "goal", "task"));
    unwrap(await getInst().db.sendMessage(reg.agentName, reg.agentKey, reg2.agentName, "hello"));

    assertOk(await getInst().db.adminDeleteAgent("doomed"));

    assertNoAgentEntries(unwrap(await getInst().db.listAgents()), "doomed");
    assertNoAgentEntries(unwrap(await getInst().db.listLocks()), "doomed");
    assert.strictEqual(unwrap(await getInst().db.getPlan("doomed")), null);
  });

  it("adminDeleteAgent fails for nonexistent agent", async (): Promise<void> => {
    assertError(await getInst().db.adminDeleteAgent("ghost"), "NOT_FOUND");
  });

  it("adminSendMessage sends without auth", async (): Promise<void> => {
    await registerAgent(getInst(), "recipient");
    const msgId: string = unwrap(await getInst().db.adminSendMessage("system", "recipient", "hello from admin"));
    assert.strictEqual(msgId.length, EXPECTED_MESSAGE_ID_LENGTH);
  });
};

/** Register admin reset operation contract tests. */
const registerAdminResetTests = (getInst: () => DbInstance): void => {
  it("adminResetKey generates new key, invalidates old", async (): Promise<void> => {
    const reg: AgentRegistration = await registerAgent(getInst(), "agent1");
    const oldKey: string = reg.agentKey;

    const newReg: AgentRegistration = unwrap(await getInst().db.adminResetKey("agent1"));
    assert.strictEqual(newReg.agentName, "agent1");
    assert.notStrictEqual(newReg.agentKey, oldKey);
    assert.strictEqual(newReg.agentKey.length, EXPECTED_KEY_LENGTH);

    // Old key fails
    assertError(await getInst().db.authenticate("agent1", oldKey), "UNAUTHORIZED");

    // New key works
    assertOk(await getInst().db.authenticate("agent1", newReg.agentKey));
  });

  it("adminResetKey releases locks held by agent", async (): Promise<void> => {
    await registerAndAcquireLock(getInst(), "agent1", "file.ts");

    unwrap(await getInst().db.adminResetKey("agent1"));

    await assertLockReleased(getInst(), "file.ts");
  });

  it("adminResetKey fails for nonexistent agent", async (): Promise<void> => {
    assertError(await getInst().db.adminResetKey("ghost"), "NOT_FOUND");
  });

  it("adminReset clears transient data but preserves identity", async (): Promise<void> => {
    const reg: AgentRegistration = await registerAndAcquireLock(getInst(), "agent1", "file.ts");
    unwrap(await getInst().db.updatePlan(reg.agentName, reg.agentKey, "goal", "task"));

    unwrap(await getInst().db.adminReset());

    // Transient data cleared
    assert.strictEqual(unwrap(await getInst().db.listLocks()).length, 0);
    assert.strictEqual(unwrap(await getInst().db.listPlans()).length, 0);

    // Identity preserved - agent can reconnect with saved key
    await assertKeyBelongsTo(getInst(), reg.agentKey, "agent1");
  });
};
