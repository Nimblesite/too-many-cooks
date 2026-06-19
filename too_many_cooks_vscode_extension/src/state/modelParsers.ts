// Deserialization layer: MCP server snake_case wire JSON -> camelCase models.
// The model interfaces are generated from models.td by typeDiagram (types.gen.ts).
// typeDiagram emits types only (no serde), so these parsers are maintained here.
// Tracked upstream: typeDiagram should emit serde via an ADT output template.

import type {
  AgentIdentity,
  AgentPlan,
  AgentRegistration,
  DbError,
  FileLock,
  LockResult,
  Message,
} from './types.gen';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseArray<T>(
  data: unknown,
  mapper: (raw: Readonly<Record<string, unknown>>) => T,
): T[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .filter((item: unknown): item is Record<string, unknown> => { return isRecord(item); })
    .map(mapper);
}

export function stringField(record: Readonly<Record<string, unknown>>, key: string): string {
  const value: unknown = record[key];
  return typeof value === 'string' ? value : '';
}

export function numberField(record: Readonly<Record<string, unknown>>, key: string): number {
  const value: unknown = record[key];
  return typeof value === 'number' ? value : 0;
}

export function boolField(record: Readonly<Record<string, unknown>>, key: string): boolean {
  const value: unknown = record[key];
  return typeof value === 'boolean' ? value : false;
}

export function nullableStringField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value: unknown = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function nullableNumberField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value: unknown = record[key];
  return typeof value === 'number' ? value : undefined;
}

export function nullableBoolField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined {
  const value: unknown = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function parseAgentIdentity(raw: Readonly<Record<string, unknown>>): AgentIdentity {
  return {
    agentName: stringField(raw, 'agent_name'),
    lastActive: numberField(raw, 'last_active'),
    registeredAt: numberField(raw, 'registered_at'),
  };
}

export function parseAgentRegistration(raw: Readonly<Record<string, unknown>>): AgentRegistration {
  return {
    agentKey: stringField(raw, 'agent_key'),
    agentName: stringField(raw, 'agent_name'),
  };
}

export function parseFileLock(raw: Readonly<Record<string, unknown>>): FileLock {
  return {
    acquiredAt: numberField(raw, 'acquired_at'),
    agentName: stringField(raw, 'agent_name'),
    expiresAt: numberField(raw, 'expires_at'),
    filePath: stringField(raw, 'file_path'),
    reason: nullableStringField(raw, 'reason'),
    version: numberField(raw, 'version'),
  };
}

export function parseLockResult(raw: Readonly<Record<string, unknown>>): LockResult {
  const lock: unknown = raw.lock;
  return {
    acquired: boolField(raw, 'acquired'),
    error: nullableStringField(raw, 'error'),
    lock: isRecord(lock) ? parseFileLock(lock) : undefined,
  };
}

export function parseMessage(raw: Readonly<Record<string, unknown>>): Message {
  return {
    content: stringField(raw, 'content'),
    createdAt: numberField(raw, 'created_at'),
    fromAgent: stringField(raw, 'from_agent'),
    id: stringField(raw, 'id'),
    readAt: nullableNumberField(raw, 'read_at'),
    toAgent: stringField(raw, 'to_agent'),
  };
}

export function parseAgentPlan(raw: Readonly<Record<string, unknown>>): AgentPlan {
  return {
    agentName: stringField(raw, 'agent_name'),
    currentTask: stringField(raw, 'current_task'),
    goal: stringField(raw, 'goal'),
    updatedAt: numberField(raw, 'updated_at'),
  };
}

export function parseDbError(raw: Readonly<Record<string, unknown>>): DbError {
  return {
    code: stringField(raw, 'code'),
    message: stringField(raw, 'message'),
  };
}
