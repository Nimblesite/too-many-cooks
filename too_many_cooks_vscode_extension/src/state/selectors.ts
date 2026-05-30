// Derived state selectors.

import type { AgentDetails, AgentIdentity, AgentPlan, AppState, ConnectionStatus, FileLock, Message } from './types';
import type { ConnectionTarget } from '../services/connectionTypes';

/** Connection mode labels shown in the status bar. */
export const MODE_LOCAL: string = 'Local/HTTP';
export const MODE_CLOUD_STDIO: string = 'Cloud/stdio';
export const MODE_CLOUD_HTTP: string = 'Cloud/HTTP';
export const MODE_DISCONNECTED: string = 'Disconnected';

export function selectConnectionStatus(state: Readonly<AppState>): ConnectionStatus {
  return state.connectionStatus;
}

/** Status-bar mode label for the current connection status and target.
 *  Issue #12: a live connection with no explicit target is, by construction,
 *  the default local server (cloud always sets a target via the picker), so it
 *  must read as the local mode — never "Disconnected" while connected. */
export function selectModeLabel(status: ConnectionStatus, target: ConnectionTarget | null): string {
  if (status !== 'connected') { return MODE_DISCONNECTED; }
  if (target === null || target.mode === 'local') { return MODE_LOCAL; }
  return target.transport === 'stdio' ? MODE_CLOUD_STDIO : MODE_CLOUD_HTTP;
}

export function selectAgents(state: Readonly<AppState>): readonly AgentIdentity[] {
  return state.agents;
}

export function selectLocks(state: Readonly<AppState>): readonly FileLock[] {
  return state.locks;
}

export function selectMessages(state: Readonly<AppState>): readonly Message[] {
  return state.messages;
}

export function selectPlans(state: Readonly<AppState>): readonly AgentPlan[] {
  return state.plans;
}

export function selectAgentCount(state: Readonly<AppState>): number {
  return state.agents.length;
}

export function selectLockCount(state: Readonly<AppState>): number {
  return state.locks.length;
}

export function selectMessageCount(state: Readonly<AppState>): number {
  return state.messages.length;
}

export function selectUnreadMessageCount(state: Readonly<AppState>): number {
  return state.messages.filter((msg: Message): boolean => {
    return msg.readAt === null;
  }).length;
}

export function selectActiveLocks(state: Readonly<AppState>): readonly FileLock[] {
  const now: number = Date.now();
  return state.locks.filter((lock: FileLock): boolean => {
    return lock.expiresAt > now;
  });
}

export function selectExpiredLocks(state: Readonly<AppState>): readonly FileLock[] {
  const now: number = Date.now();
  return state.locks.filter((lock: FileLock): boolean => {
    return lock.expiresAt <= now;
  });
}

export function selectAgentDetails(state: Readonly<AppState>): AgentDetails[] {
  return state.agents.map((agent: AgentIdentity): AgentDetails => {
    return {
      agent,
      locks: state.locks.filter((lock: FileLock): boolean => {
        return lock.agentName === agent.agentName;
      }),
      plan: state.plans.find((plan: AgentPlan): boolean => {
        return plan.agentName === agent.agentName;
      }) ?? null,
      receivedMessages: state.messages.filter(
        (msg: Message): boolean => {
          return msg.toAgent === agent.agentName || msg.toAgent === '*';
        },
      ),
      sentMessages: state.messages.filter((msg: Message): boolean => {
        return msg.fromAgent === agent.agentName;
      }),
    };
  });
}
