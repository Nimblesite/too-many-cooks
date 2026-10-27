// Simple Redux-style store with EventEmitter pattern.

import type { AppAction, AppState, FileLock, Message } from './types';
import { initialState } from './types';

/** Key extractors shared by the immutable list helpers below. */
function agentNameKey(item: Readonly<{ agentName: string }>): string {
  return item.agentName;
}

function filePathKey(item: Readonly<{ filePath: string }>): string {
  return item.filePath;
}

/** Drop every item whose key equals `key`. */
function withoutKey<T>(items: readonly T[], keyOf: (item: Readonly<T>) => string, key: string): T[] {
  return items.filter((item: Readonly<T>): boolean => { return keyOf(item) !== key; });
}

/** Replace the item holding the same key as `value`, or append `value` when absent. */
function upsertByKey<T>(items: readonly T[], keyOf: (item: Readonly<T>) => string, value: T): T[] {
  return [...withoutKey(items, keyOf, keyOf(value)), value];
}

// Reduce agent-related actions.
function reduceAgentAction(state: Readonly<AppState>, action: Readonly<AppAction>): AppState {
  switch (action.type) {
    case 'SetAgents':
      return { ...state, agents: action.agents };
    case 'AddAgent':
      return { ...state, agents: [...state.agents, action.agent] };
    case 'RemoveAgent':
      // [VSIX-REMOVE-AGENT] Issue #43: mirror the DB cascade — drop the agent and
      // Every lock, plan, AND message (sent OR received) that references it, so the
      // UI never shows rows orphaned against a deleted agent.
      return {
        ...state,
        agents: withoutKey(state.agents, agentNameKey, action.agentName),
        locks: withoutKey(state.locks, agentNameKey, action.agentName),
        messages: state.messages.filter((message: Readonly<Message>): boolean => {
          return message.fromAgent !== action.agentName && message.toAgent !== action.agentName;
        }),
        plans: withoutKey(state.plans, agentNameKey, action.agentName),
      };
    default:
      return state;
  }
}

// Reduce lock-related actions.
function reduceLockAction(state: Readonly<AppState>, action: Readonly<AppAction>): AppState {
  switch (action.type) {
    case 'SetLocks':
      return { ...state, locks: action.locks };
    case 'UpsertLock':
      return { ...state, locks: upsertByKey(state.locks, filePathKey, action.lock) };
    case 'RemoveLock':
      return { ...state, locks: withoutKey(state.locks, filePathKey, action.filePath) };
    case 'RenewLock':
      return {
        ...state,
        locks: state.locks.map(
          (lock: Readonly<FileLock>): FileLock => {
            if (lock.filePath === action.filePath) {
              return { ...lock, expiresAt: action.expiresAt };
            }
            return lock;
          },
        ),
      };
    default:
      return state;
  }
}

// Reduce message and plan actions.
function reduceDataAction(state: Readonly<AppState>, action: Readonly<AppAction>): AppState {
  switch (action.type) {
    case 'SetMessages':
      return { ...state, messages: action.messages };
    case 'AddMessage':
      return { ...state, messages: [...state.messages, action.message] };
    case 'SetPlans':
      return { ...state, plans: action.plans };
    case 'UpsertPlan':
      return { ...state, plans: upsertByKey(state.plans, agentNameKey, action.plan) };
    default:
      return state;
  }
}

const AGENT_ACTIONS: ReadonlySet<string> = new Set(['AddAgent', 'RemoveAgent', 'SetAgents']);
const LOCK_ACTIONS: ReadonlySet<string> = new Set(['RemoveLock', 'RenewLock', 'SetLocks', 'UpsertLock']);
const DATA_ACTIONS: ReadonlySet<string> = new Set(['AddMessage', 'SetMessages', 'SetPlans', 'UpsertPlan']);

// Main reducer for the application state.
function appReducer(state: Readonly<AppState>, action: Readonly<AppAction>): AppState {
  if (action.type === 'SetConnectionStatus') {
    return { ...state, connectionStatus: action.status };
  }
  if (action.type === 'ResetState') {
    return initialState;
  }
  if (AGENT_ACTIONS.has(action.type)) {
    return reduceAgentAction(state, action);
  }
  if (LOCK_ACTIONS.has(action.type)) {
    return reduceLockAction(state, action);
  }
  if (DATA_ACTIONS.has(action.type)) {
    return reduceDataAction(state, action);
  }
  return state;
}

export class Store {
  private state: AppState = initialState;
  private readonly listeners: Set<() => void> = new Set<() => void>();

  public getState(): AppState {
    return this.state;
  }

  public dispatch(action: Readonly<AppAction>): void {
    this.state = appReducer(this.state, action);
    this.listeners.forEach((fn: () => void): void => { fn(); });
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => { this.listeners.delete(listener); };
  }
}
