/// Tests for admin operations (no auth required).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import fs from 'node:fs';

import {
  type TooManyCooksDb,
  type AgentIdentity,
  createDataConfig,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
} from 'too-many-cooks-core';
import { createDb } from '../src/db-sqlite.js';

const TEST_DB_PATH = '.test_admin.db' as const;

const deleteIfExists = (path: string): void => {
  try {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  } catch {
    // ignore
  }
};

describe('admin_test', () => {
  let db: TooManyCooksDb | undefined;

  beforeEach(() => {
    deleteIfExists(TEST_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      db = result.value;
    }
  });

  afterEach(async () => {
    await db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  it('adminDeleteLock removes lock', async () => {
    // Register agent and acquire lock
    const regResult = await db!.register('admin-test-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;
    await db!.acquireLock(
      '/admin/file.dart',
      reg.agentName,
      reg.agentKey,
      null,
      60000,
    );

    // Admin deletes lock (no auth required)
    const result = await db!.adminDeleteLock('/admin/file.dart');
    assert.strictEqual(result.ok, true);

    // Verify lock is gone
    const query = await db!.queryLock('/admin/file.dart');
    if (query.ok) {
      assert.strictEqual(query.value, null);
    }
  });

  it('adminDeleteLock fails for nonexistent lock', async () => {
    const result = await db!.adminDeleteLock('/no/such/lock.dart');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('adminDeleteAgent removes agent and all related data', async () => {
    // Register agent
    const regResult = await db!.register('delete-me-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;

    // Create agent data: lock, plan, message
    await db!.acquireLock(
      '/delete/file.dart',
      reg.agentName,
      reg.agentKey,
      null,
      60000,
    );
    await db!.updatePlan(reg.agentName, reg.agentKey, 'Goal', 'Task');

    // Register another agent to send message
    const reg2Result = await db!.register('other-agent');
    assert.strictEqual(reg2Result.ok, true);
    if (!reg2Result.ok) {return;}
    const reg2 = reg2Result.value;
    await db!.sendMessage(reg.agentName, reg.agentKey, reg2.agentName, 'Hello');

    // Admin deletes agent
    const result = await db!.adminDeleteAgent(reg.agentName);
    assert.strictEqual(result.ok, true);

    // Verify agent is gone
    const agents = await db!.listAgents();
    if (agents.ok) {
      const agentNames = agents.value.map((a: AgentIdentity) => a.agentName);
      assert.ok(!agentNames.includes('delete-me-agent'));
    }

    // Verify lock is gone
    const lock = await db!.queryLock('/delete/file.dart');
    if (lock.ok) {
      assert.strictEqual(lock.value, null);
    }

    // Verify plan is gone
    const plan = await db!.getPlan(reg.agentName);
    if (plan.ok) {
      assert.strictEqual(plan.value, null);
    }
  });

  it('adminDeleteAgent fails for nonexistent agent', async () => {
    const result = await db!.adminDeleteAgent('nonexistent-agent');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('adminResetKey generates new key', async () => {
    // Register agent
    const regResult = await db!.register('reset-key-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;
    const oldKey = reg.agentKey;

    // Reset key
    const result = await db!.adminResetKey(reg.agentName);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {return;}
    const newReg = result.value;

    assert.strictEqual(newReg.agentName, reg.agentName);
    assert.notStrictEqual(newReg.agentKey, oldKey);
    assert.strictEqual(newReg.agentKey.length, 64);
  });

  it('adminResetKey invalidates old key', async () => {
    // Register agent
    const regResult = await db!.register('invalidate-key-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;
    const oldKey = reg.agentKey;

    // Reset key
    await db!.adminResetKey(reg.agentName);

    // Old key should no longer work
    const authResult = await db!.authenticate(reg.agentName, oldKey);
    assert.strictEqual(authResult.ok, false);
    if (!authResult.ok) {
      assert.strictEqual(authResult.error.code, ERR_UNAUTHORIZED);
    }
  });

  it('adminResetKey releases locks held by agent', async () => {
    // Register agent and acquire lock
    const regResult = await db!.register('lock-reset-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;
    await db!.acquireLock(
      '/reset/file.dart',
      reg.agentName,
      reg.agentKey,
      null,
      60000,
    );

    // Reset key
    await db!.adminResetKey(reg.agentName);

    // Lock should be released
    const lock = await db!.queryLock('/reset/file.dart');
    if (lock.ok) {
      assert.strictEqual(lock.value, null);
    }
  });

  it('adminResetKey fails for nonexistent agent', async () => {
    const result = await db!.adminResetKey('nonexistent-agent');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('new key works after reset', async () => {
    // Register agent
    const regResult = await db!.register('new-key-works-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;

    // Reset key
    const resetResult = await db!.adminResetKey(reg.agentName);
    assert.strictEqual(resetResult.ok, true);
    if (!resetResult.ok) {return;}
    const newReg = resetResult.value;

    // New key should work
    const authResult = await db!.authenticate(newReg.agentName, newReg.agentKey);
    assert.strictEqual(authResult.ok, true);
  });
});
