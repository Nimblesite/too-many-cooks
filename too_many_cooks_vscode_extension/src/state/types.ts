// State types for Too Many Cooks VSCode extension.

// Re-export generated model types.
export type { AgentIdentity, AgentPlan, FileLock, Message } from 'state/types.gen';
import type { AgentIdentity, AgentPlan, FileLock, Message } from 'state/types.gen';

// Connection status to the MCP server.
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

// Agent with their associated data (computed/derived state).
export interface AgentDetails {
  readonly agent: AgentIdentity;
  readonly locks: readonly FileLock[];
  readonly plan: AgentPlan | null;
  readonly receivedMessages: readonly Message[];
  readonly sentMessages: readonly Message[];
}

// The complete application state.
export interface AppState {
  readonly agents: readonly AgentIdentity[];
  readonly connectionStatus: ConnectionStatus;
  readonly locks: readonly FileLock[];
  readonly messages: readonly Message[];
  readonly plans: readonly AgentPlan[];
}

// Initial state.
export const initialState: AppState = {
  agents: [],
  connectionStatus: 'disconnected',
  locks: [],
  messages: [],
  plans: [],
};

// Actions - discriminated union.
export type AppAction =
  { readonly agent: AgentIdentity; readonly type: 'AddAgent' } | { readonly agentName: string; readonly type: 'RemoveAgent' } | { readonly agents: readonly AgentIdentity[]; readonly type: 'SetAgents' } | { readonly expiresAt: number; readonly filePath: string; readonly type: 'RenewLock' } | { readonly filePath: string; readonly type: 'RemoveLock' } | { readonly lock: FileLock; readonly type: 'UpsertLock' } | { readonly locks: readonly FileLock[]; readonly type: 'SetLocks' } | { readonly message: Message; readonly type: 'AddMessage' } | { readonly messages: readonly Message[]; readonly type: 'SetMessages' } | { readonly plan: AgentPlan; readonly type: 'UpsertPlan' } | { readonly plans: readonly AgentPlan[]; readonly type: 'SetPlans' } | { readonly status: ConnectionStatus; readonly type: 'SetConnectionStatus' } | { readonly type: 'ResetState' };
