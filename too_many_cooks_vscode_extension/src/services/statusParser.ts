// Parse server status JSON into typed state objects.

import type { AgentIdentity, AgentPlan, FileLock, Message } from '../state/types';
import { parseAgentIdentity, parseAgentPlan, parseFileLock, parseMessage } from '../state/types.gen';

// Parsed status response from the server.
export interface StatusData {
  readonly agents: readonly AgentIdentity[];
  readonly locks: readonly FileLock[];
  readonly messages: readonly Message[];
  readonly plans: readonly AgentPlan[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArray<T>(data: unknown, mapper: (raw: Readonly<Record<string, unknown>>) => T): T[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .filter((item: unknown): item is Record<string, unknown> => { return isRecord(item); })
    .map(mapper);
}

export function parseStatusResponse(json: Readonly<Record<string, unknown>>): StatusData {
  return {
    agents: parseArray(json.agents, parseAgentIdentity),
    locks: parseArray(json.locks, parseFileLock),
    messages: parseArray(json.messages, parseMessage),
    plans: parseArray(json.plans, parseAgentPlan),
  };
}
