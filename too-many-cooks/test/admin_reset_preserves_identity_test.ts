/// Test: /admin/reset MUST preserve agent identities.
///
/// BUG: /admin/reset does DELETE FROM identity, which nukes
/// all agent registrations. After reset, agents cannot
/// reconnect with their saved keys and must re-register —
/// creating duplicate identities and polluting the agent list.
///
/// Reset should clear transient data (locks, messages, plans)
/// but preserve agent identities so agents can reconnect.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import fs from 'node:fs';

import {
  type TooManyCooksDb,
  createDataConfig,
  createDb,
} from '../lib/src/data/data.js';

const TEST_DB_PATH = '.test_admin_reset_identity.db' as const;

const deleteIfExists = (path: string): void => {
  try {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  } catch {
    // ignore
  }
};

describe('admin_reset_preserves_identity_test', () => {
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

  it('agent can reconnect with saved key after adminReset', () => {
    // 1. Register an agent and save the key
    const regResult = db!.register('persistent-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;
    assert.strictEqual(reg.agentKey.length, 64);

    // 2. Call adminReset (should clear transient data)
    const resetResult = db!.adminReset();
    assert.strictEqual(resetResult.ok, true);

    // 3. Try to reconnect with the saved key
    const lookupResult = db!.lookupByKey(reg.agentKey);

    // 4. ASSERT: reconnection MUST succeed
    assert.strictEqual(lookupResult.ok, true);
    if (lookupResult.ok) {
      assert.strictEqual(lookupResult.value, 'persistent-agent');
    }
  });

  it('adminReset clears locks and plans', () => {
    // Register and create transient data
    const regResult = db!.register('transient-agent');
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;
    db!.activate('transient-agent');
    db!.acquireLock(
      'test.dart',
      reg.agentName,
      reg.agentKey,
      'testing',
      600000,
    );
    db!.updatePlan(reg.agentName, reg.agentKey, 'test goal', 'test task');

    // Reset
    db!.adminReset();

    // Locks and plans should be empty
    const locksResult = db!.listLocks();
    assert.strictEqual(locksResult.ok, true);
    if (locksResult.ok) {
      assert.strictEqual(locksResult.value.length, 0);
    }

    const plansResult = db!.listPlans();
    assert.strictEqual(plansResult.ok, true);
    if (plansResult.ok) {
      assert.strictEqual(plansResult.value.length, 0);
    }
  });
});
