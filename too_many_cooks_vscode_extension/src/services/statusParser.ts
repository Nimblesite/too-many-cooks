// Parse server status JSON into typed state objects.

import type { AgentIdentity, AgentPlan, FileLock, Message } from '../state/types';
import {
  parseAgentIdentity,
  parseAgentPlan,
  parseArray,
  parseFileLock,
  parseMessage,
} from '../state/modelParsers';

// Parsed status response from the server.
export interface StatusData {
  readonly agents: readonly AgentIdentity[];
  readonly locks: readonly FileLock[];
  readonly messages: readonly Message[];
  readonly plans: readonly AgentPlan[];
}

export function parseStatusResponse(json: Readonly<Record<string, unknown>>): StatusData {
  return {
    agents: parseArray(json.agents, parseAgentIdentity),
    locks: parseArray(json.locks, parseFileLock),
    messages: parseArray(json.messages, parseMessage),
    plans: parseArray(json.plans, parseAgentPlan),
  };
}
