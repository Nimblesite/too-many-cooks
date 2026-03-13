/// Tests for Redux-style store and reducer.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Store } from '../../src/state/store';
import type { AgentIdentity, AgentPlan, AppState, FileLock, Message } from '../../src/state/types';
import { initialState } from '../../src/state/types';

const AGENT_1: AgentIdentity = { agentName: 'agent-1', registeredAt: 1000, lastActive: 2000 };
const AGENT_2: AgentIdentity = { agentName: 'agent-2', registeredAt: 1100, lastActive: 2100 };

const LOCK_1: FileLock = {
  filePath: '/src/file1.ts',
  agentName: 'agent-1',
  acquiredAt: 1000,
  expiresAt: 70000,
  reason: 'editing',
  version: 1,
};

const LOCK_2: FileLock = {
  filePath: '/src/file2.ts',
  agentName: 'agent-2',
  acquiredAt: 1100,
  expiresAt: 70000,
  reason: null,
  version: 1,
};

const MSG_1: Message = {
  id: 'msg-1',
  fromAgent: 'agent-1',
  toAgent: 'agent-2',
  content: 'hello',
  createdAt: 1000,
  readAt: null,
};

const PLAN_1: AgentPlan = {
  agentName: 'agent-1',
  goal: 'Fix bugs',
  currentTask: 'Reading code',
  updatedAt: 1000,
};

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

describe('Agent actions', () => {
  it('SetAgents replaces all agents', () => {
    const store: Store = new Store();
    store.dispatch({ agents: [AGENT_1, AGENT_2], type: 'SetAgents' });
    assert.strictEqual(store.getState().agents.length, 2);
  });

  it('AddAgent appends an agent', () => {
    const store: Store = new Store();
    store.dispatch({ agent: AGENT_1, type: 'AddAgent' });
    store.dispatch({ agent: AGENT_2, type: 'AddAgent' });
    assert.strictEqual(store.getState().agents.length, 2);
  });

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
});

describe('Lock actions', () => {
  it('SetLocks replaces all locks', () => {
    const store: Store = new Store();
    store.dispatch({ locks: [LOCK_1, LOCK_2], type: 'SetLocks' });
    assert.strictEqual(store.getState().locks.length, 2);
  });

  it('UpsertLock adds new lock', () => {
    const store: Store = new Store();
    store.dispatch({ lock: LOCK_1, type: 'UpsertLock' });
    assert.strictEqual(store.getState().locks.length, 1);
  });

  it('UpsertLock replaces existing lock by filePath', () => {
    const store: Store = new Store();
    store.dispatch({ lock: LOCK_1, type: 'UpsertLock' });
    const updated: FileLock = { ...LOCK_1, reason: 'refactoring', version: 2 };
    store.dispatch({ lock: updated, type: 'UpsertLock' });
    const state: AppState = store.getState();
    assert.strictEqual(state.locks.length, 1);
    assert.strictEqual(state.locks[0]?.reason, 'refactoring');
  });

  it('RemoveLock removes lock by filePath', () => {
    const store: Store = new Store();
    store.dispatch({ locks: [LOCK_1, LOCK_2], type: 'SetLocks' });
    store.dispatch({ filePath: '/src/file1.ts', type: 'RemoveLock' });
    assert.strictEqual(store.getState().locks.length, 1);
    assert.strictEqual(store.getState().locks[0]?.filePath, '/src/file2.ts');
  });

  it('RenewLock updates expiresAt', () => {
    const store: Store = new Store();
    store.dispatch({ locks: [LOCK_1], type: 'SetLocks' });
    const newExpiry: number = 999999;
    store.dispatch({ filePath: '/src/file1.ts', expiresAt: newExpiry, type: 'RenewLock' });
    assert.strictEqual(store.getState().locks[0]?.expiresAt, newExpiry);
  });

  it('RenewLock does not affect other locks', () => {
    const store: Store = new Store();
    store.dispatch({ locks: [LOCK_1, LOCK_2], type: 'SetLocks' });
    store.dispatch({ filePath: '/src/file1.ts', expiresAt: 999999, type: 'RenewLock' });
    assert.strictEqual(store.getState().locks[1]?.expiresAt, 70000);
  });
});

describe('Message and plan actions', () => {
  it('SetMessages replaces all messages', () => {
    const store: Store = new Store();
    store.dispatch({ messages: [MSG_1], type: 'SetMessages' });
    assert.strictEqual(store.getState().messages.length, 1);
  });

  it('AddMessage appends a message', () => {
    const store: Store = new Store();
    store.dispatch({ message: MSG_1, type: 'AddMessage' });
    assert.strictEqual(store.getState().messages.length, 1);
  });

  it('SetPlans replaces all plans', () => {
    const store: Store = new Store();
    store.dispatch({ plans: [PLAN_1], type: 'SetPlans' });
    assert.strictEqual(store.getState().plans.length, 1);
  });

  it('UpsertPlan adds new plan', () => {
    const store: Store = new Store();
    store.dispatch({ plan: PLAN_1, type: 'UpsertPlan' });
    assert.strictEqual(store.getState().plans.length, 1);
  });

  it('UpsertPlan replaces existing plan by agentName', () => {
    const store: Store = new Store();
    store.dispatch({ plan: PLAN_1, type: 'UpsertPlan' });
    const updated: AgentPlan = { ...PLAN_1, currentTask: 'Writing tests' };
    store.dispatch({ plan: updated, type: 'UpsertPlan' });
    const state: AppState = store.getState();
    assert.strictEqual(state.plans.length, 1);
    assert.strictEqual(state.plans[0]?.currentTask, 'Writing tests');
  });
});

describe('Connection and reset actions', () => {
  it('SetConnectionStatus updates connection status', () => {
    const store: Store = new Store();
    store.dispatch({ status: 'connecting', type: 'SetConnectionStatus' });
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
