/// Tests for the snake_case wire deserialization layer (state/modelParsers).

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  boolField,
  nullableBoolField,
  nullableNumberField,
  nullableStringField,
  numberField,
  parseAgentIdentity,
  parseAgentPlan,
  parseAgentRegistration,
  parseArray,
  parseDbError,
  parseFileLock,
  parseLockResult,
  parseMessage,
  stringField,
} from '../../src/state/modelParsers';
import { assertFieldFallback, assertMatches, describeIsRecordSuite } from './testSupport';

describe('field helpers', () => {
  it('stringField returns string value', () => {
    assert.strictEqual(stringField({ name: 'test' }, 'name'), 'test');
  });

  it('stringField returns empty for non-string', () => {
    assertFieldFallback(stringField, 'name', 42, '');
  });

  it('numberField returns number value', () => {
    assert.strictEqual(numberField({ count: 5 }, 'count'), 5);
  });

  it('numberField returns 0 for non-number', () => {
    assertFieldFallback(numberField, 'count', 'five', 0);
  });

  it('boolField returns boolean value', () => {
    assert.strictEqual(boolField({ active: true }, 'active'), true);
    assert.strictEqual(boolField({ active: false }, 'active'), false);
  });

  it('boolField returns false for non-boolean', () => {
    assertFieldFallback(boolField, 'active', 'yes', false);
  });

  it('nullableStringField returns string or null', () => {
    assert.strictEqual(nullableStringField({ reason: 'editing' }, 'reason'), 'editing');
    assert.strictEqual(nullableStringField({ reason: null }, 'reason'), null);
    assertFieldFallback(nullableStringField, 'reason', 42, null);
  });

  it('nullableNumberField returns number or null', () => {
    assert.strictEqual(nullableNumberField({ readAt: 1000 }, 'readAt'), 1000);
    assert.strictEqual(nullableNumberField({ readAt: null }, 'readAt'), null);
    assertFieldFallback(nullableNumberField, 'readAt', 'x', null);
  });

  it('nullableBoolField returns boolean or null', () => {
    assert.strictEqual(nullableBoolField({ flag: true }, 'flag'), true);
    assert.strictEqual(nullableBoolField({ flag: false }, 'flag'), false);
    assert.strictEqual(nullableBoolField({ flag: null }, 'flag'), null);
    assertFieldFallback(nullableBoolField, 'flag', 'yes', null);
  });
});

describeIsRecordSuite();

describe('parseArray', () => {
  it('parses array of records', () => {
    const data: unknown = [{ name: 'a' }, { name: 'b' }];
    const result: string[] = parseArray(data, (raw: Readonly<Record<string, unknown>>): string => {
      return stringField(raw, 'name');
    });
    assert.deepStrictEqual(result, ['a', 'b']);
  });

  it('returns empty for non-array', () => {
    assert.deepStrictEqual(parseArray('not-array', (r: Readonly<Record<string, unknown>>): Record<string, unknown> => { return r; }), []);
    assert.deepStrictEqual(parseArray(null, (r: Readonly<Record<string, unknown>>): Record<string, unknown> => { return r; }), []);
  });

  it('filters out non-record items', () => {
    const data: unknown = [{ name: 'a' }, 'not-record', null, { name: 'b' }];
    const result: string[] = parseArray(data, (raw: Readonly<Record<string, unknown>>): string => {
      return stringField(raw, 'name');
    });
    assert.deepStrictEqual(result, ['a', 'b']);
  });
});

describe('parse functions', () => {
  it('parseAgentIdentity', () => {
    const result = parseAgentIdentity({
      agent_name: 'test-agent',
      registered_at: 1000,
      last_active: 2000,
    });
    assert.strictEqual(result.agentName, 'test-agent');
    assert.strictEqual(result.registeredAt, 1000);
    assert.strictEqual(result.lastActive, 2000);
  });

  it('parseAgentRegistration', () => {
    const result = parseAgentRegistration({
      agent_name: 'test-agent',
      agent_key: 'secret-key',
    });
    assert.strictEqual(result.agentName, 'test-agent');
    assert.strictEqual(result.agentKey, 'secret-key');
  });

  it('parseFileLock', () => {
    const result = parseFileLock({
      file_path: '/src/test.ts',
      agent_name: 'test-agent',
      acquired_at: 1000,
      expires_at: 70000,
      reason: 'editing',
      version: 3,
    });
    assertMatches(result, {
      filePath: '/src/test.ts',
      agentName: 'test-agent',
      acquiredAt: 1000,
      expiresAt: 70000,
      reason: 'editing',
      version: 3,
    });
  });

  it('parseFileLock with null reason', () => {
    const result = parseFileLock({
      file_path: '/src/test.ts',
      agent_name: 'test-agent',
      acquired_at: 1000,
      expires_at: 70000,
      reason: null,
      version: 1,
    });
    assert.strictEqual(result.reason, null);
  });

  it('parseLockResult with lock', () => {
    const result = parseLockResult({
      acquired: true,
      error: null,
      lock: {
        file_path: '/src/test.ts',
        agent_name: 'test-agent',
        acquired_at: 1000,
        expires_at: 70000,
        reason: null,
        version: 1,
      },
    });
    assert.strictEqual(result.acquired, true);
    assert.notStrictEqual(result.lock, null);
    assert.strictEqual(result.lock?.filePath, '/src/test.ts');
    assert.strictEqual(result.error, null);
  });

  it('parseLockResult without lock', () => {
    const result = parseLockResult({
      acquired: false,
      error: 'Held by other',
      lock: null,
    });
    assert.strictEqual(result.acquired, false);
    assert.strictEqual(result.lock, null);
    assert.strictEqual(result.error, 'Held by other');
  });

  it('parseMessage', () => {
    const result = parseMessage({
      id: 'msg-1',
      from_agent: 'sender',
      to_agent: 'receiver',
      content: 'hello',
      created_at: 1000,
      read_at: 2000,
    });
    assertMatches(result, {
      id: 'msg-1',
      fromAgent: 'sender',
      toAgent: 'receiver',
      content: 'hello',
      createdAt: 1000,
      readAt: 2000,
    });
  });

  it('parseMessage with null readAt', () => {
    const result = parseMessage({
      id: 'msg-2',
      from_agent: 'a',
      to_agent: 'b',
      content: 'hi',
      created_at: 1000,
      read_at: null,
    });
    assert.strictEqual(result.readAt, null);
  });

  it('parseAgentPlan', () => {
    const result = parseAgentPlan({
      agent_name: 'test-agent',
      goal: 'Fix bugs',
      current_task: 'Reading code',
      updated_at: 5000,
    });
    assertMatches(result, {
      agentName: 'test-agent',
      goal: 'Fix bugs',
      currentTask: 'Reading code',
      updatedAt: 5000,
    });
  });

  it('parseDbError', () => {
    const result = parseDbError({
      code: 'ERR_NOT_FOUND',
      message: 'Not found',
    });
    assertMatches(result, { code: 'ERR_NOT_FOUND', message: 'Not found' });
  });
});
