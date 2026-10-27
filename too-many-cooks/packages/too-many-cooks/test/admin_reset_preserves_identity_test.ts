/// Test: /admin/reset MUST preserve agent identities.
///
/// BUG: /admin/reset does DELETE FROM identity, which nukes
/// all agent registrations. After reset, agents cannot
/// reconnect with their saved keys and must re-register —
/// creating duplicate identities and polluting the agent list.
///
/// Reset should clear transient data (locks, messages, plans)
/// but preserve agent identities so agents can reconnect.

import { describe, it } from "node:test";
import assert from "node:assert";

import { bindTestDb } from "./support/db_fixture.js";
import { expectOk } from "./support/assertions.js";

const TEST_DB_PATH = '.test_admin_reset_identity.db';

describe('admin_reset_preserves_identity_test', () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  it('agent can reconnect with saved key after adminReset', async () => {
    // 1. Register an agent and save the key
    const reg = expectOk(await testDb.db().register('persistent-agent'), 'reg must be ok');
    assert.strictEqual(reg.agentKey.length, 64);

    // 2. Call adminReset (should clear transient data)
    const resetResult = await testDb.db().adminReset();
    assert.strictEqual(resetResult.ok, true);

    // 3. Try to reconnect with the saved key
    const lookupResult = await testDb.db().lookupByKey(reg.agentKey);

    // 4. ASSERT: reconnection MUST succeed
    assert.strictEqual(lookupResult.ok, true);
    if (lookupResult.ok) {
      assert.strictEqual(lookupResult.value, 'persistent-agent');
    }
  });

  it('adminReset clears locks and plans', async () => {
    // Register and create transient data
    const reg = expectOk(await testDb.db().register('transient-agent'), 'reg must be ok');
    await testDb.db().activate('transient-agent');
    await testDb.db().acquireLock(
      'test.dart',
      reg.agentName,
      reg.agentKey,
      'testing',
      600000,
    );
    await testDb.db().updatePlan(reg.agentName, reg.agentKey, 'test goal', 'test task');

    // Reset
    await testDb.db().adminReset();

    // Locks and plans should be empty
    const locksResult = await testDb.db().listLocks();
    assert.strictEqual(locksResult.ok, true);
    if (locksResult.ok) {
      assert.strictEqual(locksResult.value.length, 0);
    }

    const plansResult = await testDb.db().listPlans();
    assert.strictEqual(plansResult.ok, true);
    if (plansResult.ok) {
      assert.strictEqual(plansResult.value.length, 0);
    }
  });
});
