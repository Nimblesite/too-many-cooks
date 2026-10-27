// Shared fixtures and assertion helpers for pure (node:test) tests.

import assert from 'node:assert';
import { readFileSync, rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { isRecord } from '../../src/services/httpClient';
import { Store } from '../../src/state/store';
import type { AppState } from '../../src/state/types';
import type { AgentIdentity, AgentPlan, AppAction, FileLock, Message } from '../../src/state/types';
import type { CloudTarget, LocalTarget } from '../../src/services/connectionTypes';

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

const DEFAULT_LOCAL_PORT = 4040;
const CLOUD_TARGET_BASE: CloudTarget = {
  apiKey: 'key',
  apiUrl: 'https://api.example.com',
  mode: 'cloud',
  passphrase: 'secret',
  tenantId: 'tenant-1',
  transport: 'stdio',
  workspaceId: 'ws-1',
};

/** Local connection target fixture, always HTTP Streamable. */
export function makeLocalTarget(port: number = DEFAULT_LOCAL_PORT): LocalTarget {
  return { mode: 'local', port, transport: 'http-streamable' };
}

/** Cloud connection target fixture with every required field set. */
export function makeCloudTarget(overrides: Partial<CloudTarget> = {}): CloudTarget {
  return { ...CLOUD_TARGET_BASE, ...overrides };
}

/** Narrow an unknown value to a JSON record, throwing when it is not one. */
export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) { throw new Error(`Expected a JSON record: ${label}`); }
  return value;
}

/** Read a nested record field, throwing when it is missing or not a record. */
export function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return requireRecord(record[key], key);
}

/** Parse a JSON file as a record, throwing when the content is not an object. */
export function readJsonRecord(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  return requireRecord(parsed, path);
}

/** Count of a collection in a store state, keyed by the state field name. */
export type StateCollection = 'agents' | 'locks' | 'messages' | 'plans';

/** Number of entries in one state collection. */
export function countState(state: AppState, collection: StateCollection): number {
  return state[collection].length;
}

/**
 * Register the hooks that boot and stop a local test HTTP server.
 * [TEST-HTTP-SERVER] Every HTTP-backed pure suite used to copy this block.
 */
export function useTestServer(start: () => Promise<void>, stop: () => Promise<void>): void {
  before(async (): Promise<void> => { await start(); });
  after(async (): Promise<void> => { await stop(); });
}

/** A store action case: actions applied to a fresh store, then a count assertion. */
export interface CollectionActionCase {
  readonly actions: readonly AppAction[];
  readonly collection: StateCollection;
  readonly expected: number;
  readonly name: string;
}

/** Run one `it` per action case, asserting the resulting collection size. */
export function describeCollectionActionCases(cases: readonly CollectionActionCase[]): void {
  for (const actionCase of cases) {
    it(actionCase.name, () => {
      const state: AppState = storeWith(...actionCase.actions).getState();
      assert.strictEqual(
        countState(state, actionCase.collection),
        actionCase.expected,
        actionCase.name,
      );
    });
  }
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
