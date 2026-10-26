// Deserialization layer: MCP server snake_case wire JSON -> camelCase models.
// The model interfaces are generated from models.td by typeDiagram (types.gen.ts).
// TypeDiagram emits types only (no serde), so these parsers live here by hand.
// Tracked upstream: Nimblesite/typeDiagram#51 (emit serde via an ADT output template).

import type {
  AgentIdentity,
  AgentPlan,
  AgentRegistration,
  DbError,
  FileLock,
  LockResult,
  Message,
} from './types.gen';
import { isRecord } from '../services/httpClient';

export { isRecord };

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

interface FieldLookup<T> {
  readonly fallback: T | null;
  readonly key: string;
  readonly guard: (value: unknown) => value is T;
  readonly record: Readonly<Record<string, unknown>>;
}

function field<T>(lookup: Readonly<FieldLookup<T>>): T | null {
  const value: unknown = lookup.record[lookup.key];
  return lookup.guard(value) ? value : lookup.fallback;
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
  return field({ fallback: '', guard: isString, key, record }) ?? '';
}

export function numberField(record: Readonly<Record<string, unknown>>, key: string): number {
  return field({ fallback: 0, guard: isNumber, key, record }) ?? 0;
}

export function boolField(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return field({ fallback: false, guard: isBoolean, key, record }) ?? false;
}

export function nullableStringField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  return field({ fallback: null, guard: isString, key, record });
}

export function nullableNumberField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number | null {
  return field({ fallback: null, guard: isNumber, key, record });
}

export function nullableBoolField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean | null {
  return field({ fallback: null, guard: isBoolean, key, record });
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
  const lockValue: unknown = raw.lock;
  return {
    acquired: boolField(raw, 'acquired'),
    error: nullableStringField(raw, 'error'),
    lock: isRecord(lockValue) ? parseFileLock(lockValue) : null,
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
