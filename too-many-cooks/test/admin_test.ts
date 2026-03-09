/// Tests for admin operations (no auth required).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import fs from 'node:fs';

import {
  type TooManyCooksDb,
  type AgentIdentity,
  createDataConfig,
  createDb,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
} from '../lib/src/data/data.js';

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

  afterEach(() => {
    db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  it('adminDeleteLock removes lock', () => {
    // Register agent and acquire lock
    const regResult = db!.register('admin-test-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;
    db!.acquireLock(
      '/admin/file.dart',
      reg.agentName,
      reg.agentKey,
      null,
      60000,
    );

    // Admin deletes lock (no auth required)
    const result = db!.adminDeleteLock('/admin/file.dart');
    assert.strictEqual(result.ok, true);

    // Verify lock is gone
    const query = db!.queryLock('/admin/file.dart');
    if (query.ok) {
      assert.strictEqual(query.value, null);
    }
  });

  it('adminDeleteLock fails for nonexistent lock', () => {
    const result = db!.adminDeleteLock('/no/such/lock.dart');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('adminDeleteAgent removes agent and all related data', () => {
    // Register agent
    const regResult = db!.register('delete-me-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;

    // Create agent data: lock, plan, message
    db!.acquireLock(
      '/delete/file.dart',
      reg.agentName,
      reg.agentKey,
      null,
      60000,
    );
    db!.updatePlan(reg.agentName, reg.agentKey, 'Goal', 'Task');

    // Register another agent to send message
    const reg2Result = db!.register('other-agent');
    assert.strictEqual(reg2Result.ok, true);
    if (!reg2Result.ok) {return;}
    const reg2 = reg2Result.value;
    db!.sendMessage(reg.agentName, reg.agentKey, reg2.agentName, 'Hello');

    // Admin deletes agent
    const result = db!.adminDeleteAgent(reg.agentName);
    assert.strictEqual(result.ok, true);

    // Verify agent is gone
    const agents = db!.listAgents();
    if (agents.ok) {
      const agentNames = agents.value.map((a: AgentIdentity) => a.agentName);
      assert.ok(!agentNames.includes('delete-me-agent'));
    }

    // Verify lock is gone
    const lock = db!.queryLock('/delete/file.dart');
    if (lock.ok) {
      assert.strictEqual(lock.value, null);
    }

    // Verify plan is gone
    const plan = db!.getPlan(reg.agentName);
    if (plan.ok) {
      assert.strictEqual(plan.value, null);
    }
  });

  it('adminDeleteAgent fails for nonexistent agent', () => {
    const result = db!.adminDeleteAgent('nonexistent-agent');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('adminResetKey generates new key', () => {
    // Register agent
    const regResult = db!.register('reset-key-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;
    const oldKey = reg.agentKey;

    // Reset key
    const result = db!.adminResetKey(reg.agentName);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {return;}
    const newReg = result.value;

    assert.strictEqual(newReg.agentName, reg.agentName);
    assert.notStrictEqual(newReg.agentKey, oldKey);
    assert.strictEqual(newReg.agentKey.length, 64);
  });

  it('adminResetKey invalidates old key', () => {
    // Register agent
    const regResult = db!.register('invalidate-key-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;
    const oldKey = reg.agentKey;

    // Reset key
    db!.adminResetKey(reg.agentName);

    // Old key should no longer work
    const authResult = db!.authenticate(reg.agentName, oldKey);
    assert.strictEqual(authResult.ok, false);
    if (!authResult.ok) {
      assert.strictEqual(authResult.error.code, ERR_UNAUTHORIZED);
    }
  });

  it('adminResetKey releases locks held by agent', () => {
    // Register agent and acquire lock
    const regResult = db!.register('lock-reset-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;
    db!.acquireLock(
      '/reset/file.dart',
      reg.agentName,
      reg.agentKey,
      null,
      60000,
    );

    // Reset key
    db!.adminResetKey(reg.agentName);

    // Lock should be released
    const lock = db!.queryLock('/reset/file.dart');
    if (lock.ok) {
      assert.strictEqual(lock.value, null);
    }
  });

  it('adminResetKey fails for nonexistent agent', () => {
    const result = db!.adminResetKey('nonexistent-agent');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('new key works after reset', () => {
    // Register agent
    const regResult = db!.register('new-key-works-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;

    // Reset key
    const resetResult = db!.adminResetKey(reg.agentName);
    assert.strictEqual(resetResult.ok, true);
    if (!resetResult.ok) {return;}
    const newReg = resetResult.value;

    // New key should work
    const authResult = db!.authenticate(newReg.agentName, newReg.agentKey);
    assert.strictEqual(authResult.ok, true);
  });
});
