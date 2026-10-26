/// Tests for admin operations (no auth required).

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  type AgentIdentity,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
} from 'too-many-cooks-core';
import { bindTestDb } from "./support/db_fixture.js";
import { expectOk } from "./support/assertions.js";

const TEST_DB_PATH = '.test_admin.db';

describe('admin_test', () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  it('adminDeleteLock removes lock', async () => {
    // Register agent and acquire lock
    const reg = expectOk(await testDb.db().register('admin-test-agent'), 'reg must be ok');
    await testDb.db().acquireLock(
      '/admin/file.dart',
      reg.agentName,
      reg.agentKey,
      null,
      60000,
    );

    // Admin deletes lock (no auth required)
    const result = await testDb.db().adminDeleteLock('/admin/file.dart');
    assert.strictEqual(result.ok, true);

    // Verify lock is gone
    const query = await testDb.db().queryLock('/admin/file.dart');
    if (query.ok) {
      assert.strictEqual(query.value, null);
    }
  });

  it('adminDeleteLock fails for nonexistent lock', async () => {
    const result = await testDb.db().adminDeleteLock('/no/such/lock.dart');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('adminDeleteAgent removes agent and all related data', async () => {
    // Register agent
    const reg = expectOk(await testDb.db().register('delete-me-agent'), 'reg must be ok');

    // Create agent data: lock, plan, message
    await testDb.db().acquireLock(
      '/delete/file.dart',
      reg.agentName,
      reg.agentKey,
      null,
      60000,
    );
    await testDb.db().updatePlan(reg.agentName, reg.agentKey, 'Goal', 'Task');

    // Register another agent to send message
    const reg2 = expectOk(await testDb.db().register('other-agent'), 'reg2 must be ok');
    await testDb.db().sendMessage(reg.agentName, reg.agentKey, reg2.agentName, 'Hello');

    // Admin deletes agent
    const result = await testDb.db().adminDeleteAgent(reg.agentName);
    assert.strictEqual(result.ok, true);

    // Verify agent is gone
    const agents = await testDb.db().listAgents();
    if (agents.ok) {
      const agentNames = agents.value.map((a: AgentIdentity) => a.agentName);
      assert.ok(!agentNames.includes('delete-me-agent'));
    }

    // Verify lock is gone
    const lock = await testDb.db().queryLock('/delete/file.dart');
    if (lock.ok) {
      assert.strictEqual(lock.value, null);
    }

    // Verify plan is gone
    const plan = await testDb.db().getPlan(reg.agentName);
    if (plan.ok) {
      assert.strictEqual(plan.value, null);
    }
  });

  it('adminDeleteAgent fails for nonexistent agent', async () => {
    const result = await testDb.db().adminDeleteAgent('nonexistent-agent');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('adminResetKey generates new key', async () => {
    // Register agent
    const reg = expectOk(await testDb.db().register('reset-key-agent'), 'reg must be ok');
    const oldKey = reg.agentKey;

    // Reset key
    const newReg = expectOk(await testDb.db().adminResetKey(reg.agentName), 'newReg must be ok');

    assert.strictEqual(newReg.agentName, reg.agentName);
    assert.notStrictEqual(newReg.agentKey, oldKey);
    assert.strictEqual(newReg.agentKey.length, 64);
  });

  it('adminResetKey invalidates old key', async () => {
    // Register agent
    const reg = expectOk(await testDb.db().register('invalidate-key-agent'), 'reg must be ok');
    const oldKey = reg.agentKey;

    // Reset key
    await testDb.db().adminResetKey(reg.agentName);

    // Old key should no longer work
    const authResult = await testDb.db().authenticate(reg.agentName, oldKey);
    assert.strictEqual(authResult.ok, false);
    if (!authResult.ok) {
      assert.strictEqual(authResult.error.code, ERR_UNAUTHORIZED);
    }
  });

  it('adminResetKey releases locks held by agent', async () => {
    // Register agent and acquire lock
    const reg = expectOk(await testDb.db().register('lock-reset-agent'), 'reg must be ok');
    await testDb.db().acquireLock(
      '/reset/file.dart',
      reg.agentName,
      reg.agentKey,
      null,
      60000,
    );

    // Reset key
    await testDb.db().adminResetKey(reg.agentName);

    // Lock should be released
    const lock = await testDb.db().queryLock('/reset/file.dart');
    if (lock.ok) {
      assert.strictEqual(lock.value, null);
    }
  });

  it('adminResetKey fails for nonexistent agent', async () => {
    const result = await testDb.db().adminResetKey('nonexistent-agent');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('new key works after reset', async () => {
    // Register agent
    const reg = expectOk(await testDb.db().register('new-key-works-agent'), 'reg must be ok');

    // Reset key
    const newReg = expectOk(await testDb.db().adminResetKey(reg.agentName), 'newReg must be ok');

    // New key should work
    const authResult = await testDb.db().authenticate(newReg.agentName, newReg.agentKey);
    assert.strictEqual(authResult.ok, true);
  });
});
