/// Tests for activate/deactivate agent state.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import fs from 'node:fs';

import {
  type TooManyCooksDb,
  createDataConfig,
  createDb,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
} from '../lib/src/data/data.js';

const TEST_DB_PATH = '.test_active_state.db' as const;

const deleteIfExists = (path: string): void => {
  try {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  } catch {
    // ignore
  }
};

describe('active_state_test', () => {
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

  it('activate sets agent active', () => {
    db!.register('agent1');
    const result = db!.activate('agent1');
    assert.strictEqual(result.ok, true);
  });

  it('activate fails for nonexistent agent', () => {
    const result = db!.activate('nonexistent');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('deactivate sets agent inactive', () => {
    db!.register('agent1');
    db!.activate('agent1');
    const result = db!.deactivate('agent1');
    assert.strictEqual(result.ok, true);
  });

  it('deactivate fails for nonexistent agent', () => {
    const result = db!.deactivate('nonexistent');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('deactivateAll deactivates all agents', () => {
    db!.register('agent1');
    db!.register('agent2');
    db!.activate('agent1');
    db!.activate('agent2');
    const result = db!.deactivateAll();
    assert.strictEqual(result.ok, true);
  });

  it('deactivateAll succeeds with no agents', () => {
    const result = db!.deactivateAll();
    assert.strictEqual(result.ok, true);
  });

  it('lookupByKey returns agent name', () => {
    const reg = db!.register('agent1');
    assert.strictEqual(reg.ok, true);
    if (!reg.ok) {return;}
    const key = (reg.value).agentKey;
    const result = db!.lookupByKey(key);
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.value, 'agent1');
    }
  });

  it('lookupByKey fails for invalid key', () => {
    const result = db!.lookupByKey('invalid-key');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_UNAUTHORIZED);
    }
  });
});
