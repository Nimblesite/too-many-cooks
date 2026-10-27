// Shared fixtures and assertion helpers for pure (node:test) tests.

import assert from 'node:assert';
import { rmSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isRecord } from '../../src/services/httpClient';
import { Store } from '../../src/state/store';
import type { AgentIdentity, AgentPlan, AppAction, FileLock, Message } from '../../src/state/types';

const RM_MAX_RETRIES = 5;
const RM_RETRY_DELAY_MS = 50;

/**
 * Remove a temporary directory, retrying while a just-stopped child process
 * releases the files it created there.
 */
export function removeDir(dir: string): void {
  rmSync(dir, {
    force: true,
    maxRetries: RM_MAX_RETRIES,
    recursive: true,
    retryDelay: RM_RETRY_DELAY_MS,
  });
}

/** Fresh store with the given actions already dispatched. */
export function storeWith(...actions: AppAction[]): Store {
  const store: Store = new Store();
  for (const action of actions) {
    store.dispatch(action);
  }
  return store;
}

/** Assert a field reader falls back for a wrong-typed value and for a missing key. */
export function assertFieldFallback(
  reader: (record: Record<string, unknown>, key: string) => unknown,
  key: string,
  invalidValue: unknown,
  fallback: unknown,
): void {
  assert.strictEqual(reader({ [key]: invalidValue }, key), fallback, `${key} wrong type`);
  assert.strictEqual(reader({}, key), fallback, `${key} missing`);
}

/** Values the record guard must reject. */
const NON_RECORD_VALUES: readonly unknown[] = [null, [], 'string', 42, undefined, true];

/**
 * Shared suite for the snake_case record guard.
 * [MODEL-PARSE-RECORD] Both parser modules assert the same contract, so it
 * lives here once instead of being copy-pasted per module.
 */
export function describeIsRecordSuite(): void {
  describe('isRecord', () => {
    it('returns true for plain objects', () => {
      assert.strictEqual(isRecord({}), true);
      assert.strictEqual(isRecord({ key: 'val' }), true);
    });

    it('returns false for non-objects', () => {
      for (const value of NON_RECORD_VALUES) {
        assert.strictEqual(isRecord(value), false, `isRecord(${String(value)})`);
      }
    });
  });
}

/** Assert every expected key/value pair matches on the actual object. */
export function assertMatches<T extends object>(actual: T, expected: Readonly<Partial<T>>): void {
  const actualValues: Map<string, unknown> = new Map<string, unknown>(Object.entries(actual));
  for (const [key, expectedValue] of Object.entries(expected)) {
    assert.strictEqual(actualValues.get(key), expectedValue, key);
  }
}

/** Log capture sink handed to services under test. */
export interface LogCollector {
  readonly logs: string[];
  readonly log: (msg: string) => void;
}

/** Collect log messages. */
export function createLogCollector(): LogCollector {
  const logs: string[] = [];
  return { logs, log: (msg: string): void => { logs.push(msg); } };
}

export function makeAgentIdentity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    agentName: 'agent-1',
    registeredAt: 1000,
    lastActive: 2000,
    ...overrides,
  };
}

export function makeFileLock(overrides: Partial<FileLock> = {}): FileLock {
  return {
    filePath: '/src/file1.ts',
    agentName: 'agent-1',
    acquiredAt: 1000,
    expiresAt: 70000,
    reason: 'editing',
    version: 1,
    ...overrides,
  };
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    fromAgent: 'agent-1',
    toAgent: 'agent-2',
    content: 'hello',
    createdAt: 1000,
    readAt: null,
    ...overrides,
  };
}

export function makePlan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    agentName: 'agent-1',
    goal: 'Fix bugs',
    currentTask: 'Reading code',
    updatedAt: 1000,
    ...overrides,
  };
}
