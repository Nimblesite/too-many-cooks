/// Tests for state selectors.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { AgentIdentity, AgentPlan, AppState, FileLock, Message } from '../../src/state/types';
import { initialState } from '../../src/state/types';
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
} from '../../src/state/selectors';

import { makeAgentIdentity, makeFileLock, makeMessage, makePlan } from './testSupport';

const AGENT_1: AgentIdentity = makeAgentIdentity();
const AGENT_2: AgentIdentity = makeAgentIdentity({ agentName: 'agent-2', registeredAt: 1100, lastActive: 2100 });

const FAR_FUTURE: number = Date.now() + 600000;
const FAR_PAST: number = 1000;

const ACTIVE_LOCK: FileLock = makeFileLock({ filePath: '/active.ts', expiresAt: FAR_FUTURE });
const EXPIRED_LOCK: FileLock = makeFileLock({ filePath: '/expired.ts', agentName: 'agent-2', expiresAt: FAR_PAST, reason: null });

const MSG_UNREAD: Message = makeMessage();
const MSG_READ: Message = makeMessage({ id: 'msg-2', fromAgent: 'agent-2', toAgent: 'agent-1', content: 'hi back', createdAt: 1100, readAt: 1200 });
const BROADCAST_MSG: Message = makeMessage({ id: 'msg-3', toAgent: '*', content: 'everyone', createdAt: 1300 });

const PLAN_1: AgentPlan = makePlan();

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    ...initialState,
    ...overrides,
  };
}

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

/** Each lock-filtering selector with the single path it must keep. */
const LOCK_FILTER_CASES: readonly {
  readonly expectedPath: string;
  readonly name: string;
  readonly select: (state: AppState) => readonly FileLock[];
}[] = [
  { expectedPath: '/active.ts', name: 'selectActiveLocks filters to non-expired', select: selectActiveLocks },
  { expectedPath: '/expired.ts', name: 'selectExpiredLocks filters to expired', select: selectExpiredLocks },
];

describe('lock filtering selectors', () => {
  for (const lockCase of LOCK_FILTER_CASES) {
    it(lockCase.name, () => {
      const selected: readonly FileLock[] = lockCase.select(makeState({ locks: [ACTIVE_LOCK, EXPIRED_LOCK] }));
      assert.strictEqual(selected.length, 1);
      assert.strictEqual(selected[0]?.filePath, lockCase.expectedPath);
    });
  }
});

/** Expected derived details for one agent in the selection fixture. */
interface DetailExpectation {
  readonly agentName: string;
  readonly locks: number;
  readonly planGoal: string | null;
  readonly received: number;
  readonly sent: number;
}

const DETAIL_EXPECTATIONS: readonly DetailExpectation[] = [
  { agentName: 'agent-1', locks: 1, planGoal: 'Fix bugs', received: 2, sent: 2 },
  { agentName: 'agent-2', locks: 1, planGoal: null, received: 2, sent: 1 },
];

describe('selectAgentDetails', () => {
  it('computes details for each agent', () => {
    const state: AppState = makeState({
      agents: [AGENT_1, AGENT_2],
      locks: [ACTIVE_LOCK, EXPIRED_LOCK],
      messages: [MSG_UNREAD, MSG_READ, BROADCAST_MSG],
      plans: [PLAN_1],
    });
    const details = selectAgentDetails(state);
    assert.strictEqual(details.length, DETAIL_EXPECTATIONS.length);

    for (const expected of DETAIL_EXPECTATIONS) {
      const detail = details.find((entry) => entry.agent.agentName === expected.agentName);
      assert.strictEqual(detail?.agent.agentName, expected.agentName);
      assert.strictEqual(detail?.locks.length, expected.locks);
      assert.strictEqual(detail?.plan?.goal ?? null, expected.planGoal);
      assert.strictEqual(detail?.sentMessages.length, expected.sent);
      assert.strictEqual(detail?.receivedMessages.length, expected.received);
    }
  });

  it('returns empty for no agents', () => {
    assert.strictEqual(selectAgentDetails(makeState()).length, 0);
  });
});
