/// Tests for activate/deactivate agent state.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import fs from 'node:fs';

import {
  type TooManyCooksDb,
  createDataConfig,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
} from '@too-many-cooks/core';
import { createDb } from '../src/db-sqlite.js';

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

  afterEach(async () => {
    await db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  it('activate sets agent active', async () => {
    await db!.register('agent1');
    const result = await db!.activate('agent1');
    assert.strictEqual(result.ok, true);
  });

  it('activate fails for nonexistent agent', async () => {
    const result = await db!.activate('nonexistent');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('deactivate sets agent inactive', async () => {
    await db!.register('agent1');
    await db!.activate('agent1');
    const result = await db!.deactivate('agent1');
    assert.strictEqual(result.ok, true);
  });

  it('deactivate fails for nonexistent agent', async () => {
    const result = await db!.deactivate('nonexistent');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_NOT_FOUND);
    }
  });

  it('deactivateAll deactivates all agents', async () => {
    await db!.register('agent1');
    await db!.register('agent2');
    await db!.activate('agent1');
    await db!.activate('agent2');
    const result = await db!.deactivateAll();
    assert.strictEqual(result.ok, true);
  });

  it('deactivateAll succeeds with no agents', async () => {
    const result = await db!.deactivateAll();
    assert.strictEqual(result.ok, true);
  });

  it('lookupByKey returns agent name', async () => {
    const reg = await db!.register('agent1');
    assert.strictEqual(reg.ok, true);
    if (!reg.ok) {return;}
    const key = (reg.value).agentKey;
    const result = await db!.lookupByKey(key);
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.value, 'agent1');
    }
  });

  it('lookupByKey fails for invalid key', async () => {
    const result = await db!.lookupByKey('invalid-key');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, ERR_UNAUTHORIZED);
    }
  });
});
