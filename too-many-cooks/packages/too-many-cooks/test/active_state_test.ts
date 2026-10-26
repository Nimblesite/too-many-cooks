/// Tests for activate/deactivate agent state.

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
} from 'too-many-cooks-core';
import { bindTestDb } from "./support/db_fixture.js";

const TEST_DB_PATH = '.test_active_state.db';

describe('active_state_test', () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  it('activate sets agent active', async () => {
    await testDb.db().register('agent1');
    const result = await testDb.db().activate('agent1');
    assert.strictEqual(result.ok, true);
  });

  it('activate fails for nonexistent agent', async () => {
    const result = await testDb.db().activate('nonexistent');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('deactivate sets agent inactive', async () => {
    await testDb.db().register('agent1');
    await testDb.db().activate('agent1');
    const result = await testDb.db().deactivate('agent1');
    assert.strictEqual(result.ok, true);
  });

  it('deactivate fails for nonexistent agent', async () => {
    const result = await testDb.db().deactivate('nonexistent');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('deactivateAll deactivates all agents', async () => {
    await testDb.db().register('agent1');
    await testDb.db().register('agent2');
    await testDb.db().activate('agent1');
    await testDb.db().activate('agent2');
    const result = await testDb.db().deactivateAll();
    assert.strictEqual(result.ok, true);
  });

  it('deactivateAll succeeds with no agents', async () => {
    const result = await testDb.db().deactivateAll();
    assert.strictEqual(result.ok, true);
  });

  it('lookupByKey returns agent name', async () => {
    const reg = await testDb.db().register('agent1');
    assert.strictEqual(reg.ok, true);
    if (!reg.ok) {return;}
    const key = (reg.value).agentKey;
    const result = await testDb.db().lookupByKey(key);
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.value, 'agent1');
    }
  });

  it('lookupByKey fails for invalid key', async () => {
    const result = await testDb.db().lookupByKey('invalid-key');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_UNAUTHORIZED);
    }
  });
});
