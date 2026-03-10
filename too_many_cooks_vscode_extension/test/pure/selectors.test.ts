/// Tests for state selectors.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import 'module-alias/register';
import type { AgentIdentity, AgentPlan, AppState, FileLock, Message } from 'state/types';
import { initialState } from 'state/types';
import {
  selectAgentCount,
  selectAgentDetails,
  selectAgents,
  selectActiveLocks,
  selectConnectionStatus,
  selectExpiredLocks,
  selectLockCount,
  selectLocks,
  selectMessageCount,
  selectMessages,
  selectPlans,
  selectUnreadMessageCount,
} from 'state/selectors';

const AGENT_1: AgentIdentity = { agentName: 'agent-1', registeredAt: 1000, lastActive: 2000 };
const AGENT_2: AgentIdentity = { agentName: 'agent-2', registeredAt: 1100, lastActive: 2100 };

const FAR_FUTURE: number = Date.now() + 600000;
const FAR_PAST: number = 1000;

const ACTIVE_LOCK: FileLock = {
  filePath: '/active.ts',
  agentName: 'agent-1',
  acquiredAt: 1000,
  expiresAt: FAR_FUTURE,
  reason: 'editing',
  version: 1,
};

const EXPIRED_LOCK: FileLock = {
  filePath: '/expired.ts',
  agentName: 'agent-2',
  acquiredAt: 1000,
  expiresAt: FAR_PAST,
  reason: null,
  version: 1,
};

const MSG_UNREAD: Message = {
  id: 'msg-1',
  fromAgent: 'agent-1',
  toAgent: 'agent-2',
  content: 'hello',
  createdAt: 1000,
  readAt: null,
};

const MSG_READ: Message = {
  id: 'msg-2',
  fromAgent: 'agent-2',
  toAgent: 'agent-1',
  content: 'hi back',
  createdAt: 1100,
  readAt: 1200,
};

const BROADCAST_MSG: Message = {
  id: 'msg-3',
  fromAgent: 'agent-1',
  toAgent: '*',
  content: 'everyone',
  createdAt: 1300,
  readAt: null,
};

const PLAN_1: AgentPlan = {
  agentName: 'agent-1',
  goal: 'Fix bugs',
  currentTask: 'Reading code',
  updatedAt: 1000,
};

const makeState = (overrides: Partial<AppState> = {}): AppState => ({
  ...initialState,
  ...overrides,
});

describe('basic selectors', () => {
  it('selectConnectionStatus returns status', () => {
    assert.strictEqual(selectConnectionStatus(makeState({ connectionStatus: 'connected' })), 'connected');
  });

  it('selectAgents returns agents', () => {
    const agents: readonly AgentIdentity[] = selectAgents(makeState({ agents: [AGENT_1] }));
    assert.strictEqual(agents.length, 1);
  });

  it('selectLocks returns locks', () => {
    const locks: readonly FileLock[] = selectLocks(makeState({ locks: [ACTIVE_LOCK] }));
    assert.strictEqual(locks.length, 1);
  });

  it('selectMessages returns messages', () => {
    const msgs: readonly Message[] = selectMessages(makeState({ messages: [MSG_UNREAD] }));
    assert.strictEqual(msgs.length, 1);
  });

  it('selectPlans returns plans', () => {
    assert.strictEqual(selectPlans(makeState({ plans: [PLAN_1] })).length, 1);
  });
});

describe('count selectors', () => {
  it('selectAgentCount returns count', () => {
    assert.strictEqual(selectAgentCount(makeState({ agents: [AGENT_1, AGENT_2] })), 2);
  });

  it('selectLockCount returns count', () => {
    assert.strictEqual(selectLockCount(makeState({ locks: [ACTIVE_LOCK, EXPIRED_LOCK] })), 2);
  });

  it('selectMessageCount returns count', () => {
    assert.strictEqual(selectMessageCount(makeState({ messages: [MSG_UNREAD, MSG_READ] })), 2);
  });

  it('selectUnreadMessageCount counts only unread', () => {
    assert.strictEqual(selectUnreadMessageCount(makeState({ messages: [MSG_UNREAD, MSG_READ] })), 1);
  });

  it('selectUnreadMessageCount returns 0 for no messages', () => {
    assert.strictEqual(selectUnreadMessageCount(makeState()), 0);
  });
});

describe('lock filtering selectors', () => {
  it('selectActiveLocks filters to non-expired', () => {
    const state: AppState = makeState({ locks: [ACTIVE_LOCK, EXPIRED_LOCK] });
    const active: readonly FileLock[] = selectActiveLocks(state);
    assert.strictEqual(active.length, 1);
    assert.strictEqual(active[0]?.filePath, '/active.ts');
  });

  it('selectExpiredLocks filters to expired', () => {
    const state: AppState = makeState({ locks: [ACTIVE_LOCK, EXPIRED_LOCK] });
    const expired: readonly FileLock[] = selectExpiredLocks(state);
    assert.strictEqual(expired.length, 1);
    assert.strictEqual(expired[0]?.filePath, '/expired.ts');
  });
});

describe('selectAgentDetails', () => {
  it('computes details for each agent', () => {
    const state: AppState = makeState({
      agents: [AGENT_1, AGENT_2],
      locks: [ACTIVE_LOCK, EXPIRED_LOCK],
      messages: [MSG_UNREAD, MSG_READ, BROADCAST_MSG],
      plans: [PLAN_1],
    });
    const details = selectAgentDetails(state);
    assert.strictEqual(details.length, 2);

    const detail1 = details[0];
    assert.strictEqual(detail1?.agent.agentName, 'agent-1');
    assert.strictEqual(detail1?.locks.length, 1);
    assert.strictEqual(detail1?.plan?.goal, 'Fix bugs');
    assert.strictEqual(detail1?.sentMessages.length, 2);
    assert.strictEqual(detail1?.receivedMessages.length, 2);

    const detail2 = details[1];
    assert.strictEqual(detail2?.agent.agentName, 'agent-2');
    assert.strictEqual(detail2?.locks.length, 1);
    assert.strictEqual(detail2?.plan, null);
    assert.strictEqual(detail2?.sentMessages.length, 1);
    assert.strictEqual(detail2?.receivedMessages.length, 2);
  });

  it('returns empty for no agents', () => {
    assert.strictEqual(selectAgentDetails(makeState()).length, 0);
  });
});
