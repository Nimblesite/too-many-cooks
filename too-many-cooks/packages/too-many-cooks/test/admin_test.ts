/// Tests for admin operations (no auth required).

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  type AgentIdentity,
  type AgentRegistration,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
} from "too-many-cooks-core";
import { bindTestDb } from "./support/db_fixture.js";
import { expectErr, expectOk } from "./support/assertions.js";

const TEST_DB_PATH = ".test_admin.db";

/** Lock timeout used by the admin lock fixtures. */
const LOCK_TIMEOUT_MS = 60000;

describe("admin_test", () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  /** Registers `name`, has it lock `filePath`, and returns its identity. */
  const registeredLockHolder = async (
    name: string,
    filePath: string,
  ): Promise<AgentRegistration> => {
    const reg = expectOk(await testDb.db().register(name), "reg must be ok");
    await testDb.db().acquireLock(filePath, reg.agentName, reg.agentKey, null, LOCK_TIMEOUT_MS);
    return reg;
  };

  it("adminDeleteLock removes lock", async () => {
    // Register agent and acquire lock
    await registeredLockHolder("admin-test-agent", "/admin/file.dart");

    // Admin deletes lock (no auth required)
    const result = await testDb.db().adminDeleteLock("/admin/file.dart");
    assert.strictEqual(result.ok, true);

    // Verify lock is gone
    const lock = expectOk(await testDb.db().queryLock("/admin/file.dart"), "query must be ok");
    assert.strictEqual(lock, null);
  });

  it("adminDeleteLock fails for nonexistent lock", async () => {
    const error = expectErr(
      await testDb.db().adminDeleteLock("/no/such/lock.dart"),
      "delete must fail",
    );
    assert.strictEqual(error.code, ERR_NOT_FOUND);
  });

  it("adminDeleteAgent removes agent and all related data", async () => {
    // Register agent, then create its data: lock, plan, message
    const reg = await registeredLockHolder("delete-me-agent", "/delete/file.dart");
    await testDb.db().updatePlan(reg.agentName, reg.agentKey, "Goal", "Task");

    // Register another agent to send message
    const reg2 = expectOk(await testDb.db().register("other-agent"), "reg2 must be ok");
    await testDb.db().sendMessage(reg.agentName, reg.agentKey, reg2.agentName, "Hello");

    // Admin deletes agent
    const result = await testDb.db().adminDeleteAgent(reg.agentName);
    assert.strictEqual(result.ok, true);

    // Verify agent is gone
    const agents = expectOk(await testDb.db().listAgents(), "list must be ok");
    const agentNames = agents.map((a: AgentIdentity) => a.agentName);
    assert.ok(!agentNames.includes("delete-me-agent"));

    // Verify lock is gone
    const lock = expectOk(await testDb.db().queryLock("/delete/file.dart"), "query must be ok");
    assert.strictEqual(lock, null);

    // Verify plan is gone
    const plan = expectOk(await testDb.db().getPlan(reg.agentName), "get must be ok");
    assert.strictEqual(plan, null);
  });

  it("adminDeleteAgent fails for nonexistent agent", async () => {
    const error = expectErr(
      await testDb.db().adminDeleteAgent("nonexistent-agent"),
      "delete must fail",
    );
    assert.strictEqual(error.code, ERR_NOT_FOUND);
  });

  it("adminResetKey generates new key", async () => {
    // Register agent
    const reg = expectOk(await testDb.db().register("reset-key-agent"), "reg must be ok");
    const oldKey = reg.agentKey;

    // Reset key
    const newReg = expectOk(await testDb.db().adminResetKey(reg.agentName), "newReg must be ok");

    assert.strictEqual(newReg.agentName, reg.agentName);
    assert.notStrictEqual(newReg.agentKey, oldKey);
    assert.strictEqual(newReg.agentKey.length, 64);
  });

  it("adminResetKey invalidates old key", async () => {
    // Register agent
    const reg = expectOk(await testDb.db().register("invalidate-key-agent"), "reg must be ok");
    const oldKey = reg.agentKey;

    // Reset key
    await testDb.db().adminResetKey(reg.agentName);

    // Old key should no longer work
    const error = expectErr(
      await testDb.db().authenticate(reg.agentName, oldKey),
      "authenticate must fail",
    );
    assert.strictEqual(error.code, ERR_UNAUTHORIZED);
  });

  it("adminResetKey releases locks held by agent", async () => {
    // Register agent and acquire lock
    const reg = await registeredLockHolder("lock-reset-agent", "/reset/file.dart");

    // Reset key
    await testDb.db().adminResetKey(reg.agentName);

    // Lock should be released
    const lock = expectOk(await testDb.db().queryLock("/reset/file.dart"), "query must be ok");
    assert.strictEqual(lock, null);
  });

  it("adminResetKey fails for nonexistent agent", async () => {
    const error = expectErr(
      await testDb.db().adminResetKey("nonexistent-agent"),
      "reset must fail",
    );
    assert.strictEqual(error.code, ERR_NOT_FOUND);
  });

  it("new key works after reset", async () => {
    // Register agent
    const reg = expectOk(await testDb.db().register("new-key-works-agent"), "reg must be ok");

    // Reset key
    const newReg = expectOk(await testDb.db().adminResetKey(reg.agentName), "newReg must be ok");

    // New key should work
    const authResult = await testDb.db().authenticate(newReg.agentName, newReg.agentKey);
    assert.strictEqual(authResult.ok, true);
  });
});
