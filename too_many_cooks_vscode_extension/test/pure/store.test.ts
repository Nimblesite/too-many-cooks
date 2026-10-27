/// Tests for Redux-style store and reducer.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Store } from '../../src/state/store';
import type { AgentIdentity, AgentPlan, AppAction, AppState, FileLock, Message } from '../../src/state/types';
import { initialState } from '../../src/state/types';

import { countState, makeAgentIdentity, makeFileLock, makeMessage, makePlan, describeCollectionActionCases, storeWith } from './testSupport';
import type { CollectionActionCase, StateCollection } from './testSupport';

const AGENT_1: AgentIdentity = makeAgentIdentity();
const AGENT_2: AgentIdentity = makeAgentIdentity({ agentName: 'agent-2', registeredAt: 1100, lastActive: 2100 });

const LOCK_1: FileLock = makeFileLock();
const LOCK_2: FileLock = makeFileLock({ filePath: '/src/file2.ts', agentName: 'agent-2', acquiredAt: 1100, reason: null });

const MSG_1: Message = makeMessage();
const MSG_TO_AGENT_1: Message = makeMessage({ id: 'msg-2', fromAgent: 'agent-2', toAgent: 'agent-1', content: 'reply', createdAt: 1100 });
const MSG_BETWEEN_OTHERS: Message = makeMessage({ id: 'msg-3', fromAgent: 'agent-2', toAgent: '*', content: 'broadcast', createdAt: 1200 });

const PLAN_1: AgentPlan = makePlan();

/** Collection-replacing and item-appending actions, one case per action. */
const COLLECTION_ACTION_CASES: readonly CollectionActionCase[] = [
  { actions: [{ agents: [AGENT_1, AGENT_2], type: 'SetAgents' }], collection: 'agents', expected: 2, name: 'SetAgents replaces all agents' },
  { actions: [{ agent: AGENT_1, type: 'AddAgent' }, { agent: AGENT_2, type: 'AddAgent' }], collection: 'agents', expected: 2, name: 'AddAgent appends an agent' },
  { actions: [{ locks: [LOCK_1, LOCK_2], type: 'SetLocks' }], collection: 'locks', expected: 2, name: 'SetLocks replaces all locks' },
  { actions: [{ lock: LOCK_1, type: 'UpsertLock' }], collection: 'locks', expected: 1, name: 'UpsertLock adds new lock' },
  { actions: [{ messages: [MSG_1], type: 'SetMessages' }], collection: 'messages', expected: 1, name: 'SetMessages replaces all messages' },
  { actions: [{ message: MSG_1, type: 'AddMessage' }], collection: 'messages', expected: 1, name: 'AddMessage appends a message' },
  { actions: [{ plans: [PLAN_1], type: 'SetPlans' }], collection: 'plans', expected: 1, name: 'SetPlans replaces all plans' },
  { actions: [{ plan: PLAN_1, type: 'UpsertPlan' }], collection: 'plans', expected: 1, name: 'UpsertPlan adds new plan' },
];

/** Upsert actions that must replace, not append, an item with the same key. */
interface UpsertReplacementCase {
  readonly collection: StateCollection;
  readonly expected: unknown;
  readonly name: string;
  readonly read: (state: AppState) => unknown;
  readonly setup: AppAction;
  readonly update: AppAction;
}

const UPSERT_REPLACEMENT_CASES: readonly UpsertReplacementCase[] = [
  {
    collection: 'locks',
    expected: 'refactoring',
    name: 'UpsertLock replaces existing lock by filePath',
    read: (state: AppState): unknown => state.locks[0]?.reason,
    setup: { lock: LOCK_1, type: 'UpsertLock' },
    update: { lock: { ...LOCK_1, reason: 'refactoring', version: 2 }, type: 'UpsertLock' },
  },
  {
    collection: 'plans',
    expected: 'Writing tests',
    name: 'UpsertPlan replaces existing plan by agentName',
    read: (state: AppState): unknown => state.plans[0]?.currentTask,
    setup: { plan: PLAN_1, type: 'UpsertPlan' },
    update: { plan: { ...PLAN_1, currentTask: 'Writing tests' }, type: 'UpsertPlan' },
  },
];

describe('Store', () => {
  it('starts with initial state', () => {
    const store: Store = new Store();
    const state: AppState = store.getState();
    assert.deepStrictEqual(state, initialState);
    assert.strictEqual(state.connectionStatus, 'disconnected');
    assert.strictEqual(state.agents.length, 0);
    assert.strictEqual(state.locks.length, 0);
    assert.strictEqual(state.messages.length, 0);
    assert.strictEqual(state.plans.length, 0);
  });

  it('notifies listeners on dispatch', () => {
    const store: Store = new Store();
    let callCount: number = 0;
    store.subscribe((): void => { callCount += 1; });
    store.dispatch({ agents: [AGENT_1], type: 'SetAgents' });
    assert.strictEqual(callCount, 1);
  });

  it('unsubscribe stops notifications', () => {
    const store: Store = new Store();
    let callCount: number = 0;
    const unsub: () => void = store.subscribe((): void => { callCount += 1; });
    store.dispatch({ agents: [AGENT_1], type: 'SetAgents' });
    assert.strictEqual(callCount, 1);
    unsub();
    store.dispatch({ agents: [], type: 'SetAgents' });
    assert.strictEqual(callCount, 1);
  });
});

describe('Collection actions', () => {
  describeCollectionActionCases(COLLECTION_ACTION_CASES);
});

describe('Agent actions', () => {
  it('RemoveAgent removes agent and associated locks and plans', () => {
    const store: Store = new Store();
    store.dispatch({ agents: [AGENT_1, AGENT_2], type: 'SetAgents' });
    store.dispatch({ locks: [LOCK_1, LOCK_2], type: 'SetLocks' });
    store.dispatch({ plans: [PLAN_1], type: 'SetPlans' });

    store.dispatch({ agentName: 'agent-1', type: 'RemoveAgent' });
    const state: AppState = store.getState();
    assert.strictEqual(state.agents.length, 1);
    assert.strictEqual(state.agents[0]?.agentName, 'agent-2');
    assert.strictEqual(state.locks.length, 1);
    assert.strictEqual(state.locks[0]?.agentName, 'agent-2');
    assert.strictEqual(state.plans.length, 0);
  });

  // [VSIX-REMOVE-AGENT] Issue #43: removing an agent must also drop every message
  // it sent OR received — otherwise the message tree shows orphans referencing a
  // deleted agent. Mirrors the DB's from_agent/to_agent cascade delete.
  it('RemoveAgent removes messages the agent sent or received', () => {
    const store: Store = new Store();
    store.dispatch({ agents: [AGENT_1, AGENT_2], type: 'SetAgents' });
    store.dispatch({ messages: [MSG_1, MSG_TO_AGENT_1, MSG_BETWEEN_OTHERS], type: 'SetMessages' });

    store.dispatch({ agentName: 'agent-1', type: 'RemoveAgent' });
    const state: AppState = store.getState();

    assert.strictEqual(
      state.messages.some((m: Readonly<Message>): boolean => m.fromAgent === 'agent-1' || m.toAgent === 'agent-1'),
      false,
      'no message touching the removed agent may survive',
    );
    assert.strictEqual(state.messages.length, 1, 'only the message not touching agent-1 remains');
    assert.strictEqual(state.messages[0]?.id, 'msg-3');
  });
});

describe('Lock actions', () => {
  it('RemoveLock removes lock by filePath', () => {
    const store: Store = new Store();
    store.dispatch({ locks: [LOCK_1, LOCK_2], type: 'SetLocks' });
    store.dispatch({ filePath: '/src/file1.ts', type: 'RemoveLock' });
    assert.strictEqual(store.getState().locks.length, 1);
    assert.strictEqual(store.getState().locks[0]?.filePath, '/src/file2.ts');
  });

  it('RenewLock updates expiresAt', () => {
    const store: Store = storeWith({ locks: [LOCK_1], type: 'SetLocks' });
    const newExpiry: number = 999999;
    store.dispatch({ filePath: '/src/file1.ts', expiresAt: newExpiry, type: 'RenewLock' });
    assert.strictEqual(store.getState().locks[0]?.expiresAt, newExpiry);
  });

  it('RenewLock does not affect other locks', () => {
    const store: Store = storeWith({ locks: [LOCK_1, LOCK_2], type: 'SetLocks' });
    store.dispatch({ filePath: '/src/file1.ts', expiresAt: 999999, type: 'RenewLock' });
    assert.strictEqual(store.getState().locks[1]?.expiresAt, 70000);
  });
});

describe('Message and plan actions', () => {
  for (const upsertCase of UPSERT_REPLACEMENT_CASES) {
    it(upsertCase.name, () => {
      const store: Store = storeWith(upsertCase.setup);
      store.dispatch(upsertCase.update);
      const state: AppState = store.getState();
      assert.strictEqual(countState(state, upsertCase.collection), 1, `${upsertCase.name} must not append`);
      assert.strictEqual(upsertCase.read(state), upsertCase.expected, upsertCase.name);
    });
  }
});

describe('Connection and reset actions', () => {
  it('SetConnectionStatus updates connection status', () => {
    const store: Store = storeWith({ status: 'connecting', type: 'SetConnectionStatus' });
    assert.strictEqual(store.getState().connectionStatus, 'connecting');
    store.dispatch({ status: 'connected', type: 'SetConnectionStatus' });
    assert.strictEqual(store.getState().connectionStatus, 'connected');
  });

  it('ResetState returns to initial state', () => {
    const store: Store = new Store();
    store.dispatch({ agents: [AGENT_1], type: 'SetAgents' });
    store.dispatch({ locks: [LOCK_1], type: 'SetLocks' });
    store.dispatch({ status: 'connected', type: 'SetConnectionStatus' });
    store.dispatch({ type: 'ResetState' });
    assert.deepStrictEqual(store.getState(), initialState);
  });
});
