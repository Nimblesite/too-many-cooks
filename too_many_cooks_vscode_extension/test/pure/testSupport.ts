// Shared fixtures and assertion helpers for pure (node:test) tests.

import assert from 'node:assert';
import type { AgentIdentity, AgentPlan, FileLock, Message } from '../../src/state/types';

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
