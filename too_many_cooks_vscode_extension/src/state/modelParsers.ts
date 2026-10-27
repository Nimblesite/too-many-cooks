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

/** Signature of a field reader that falls back when the field is absent or invalid. */
type FieldReader<T> = (record: Readonly<Record<string, unknown>>, key: string) => T;

/** Signature of a field reader that yields null when the field is absent or invalid. */
type NullableFieldReader<T> = (record: Readonly<Record<string, unknown>>, key: string) => T | null;

const STRING_FALLBACK: string = '';
const NUMBER_FALLBACK: number = 0;
const BOOLEAN_FALLBACK: boolean = false;

function readField<T>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  guard: (value: unknown) => value is T,
): T | null {
  const value: unknown = record[key];
  return guard(value) ? value : null;
}

function requiredReader<T>(
  guard: (value: unknown) => value is T,
  fallback: T,
): FieldReader<T> {
  return (record: Readonly<Record<string, unknown>>, key: string): T => {
    return readField(record, key, guard) ?? fallback;
  };
}

function nullableReader<T>(guard: (value: unknown) => value is T): NullableFieldReader<T> {
  return (record: Readonly<Record<string, unknown>>, key: string): T | null => {
    return readField(record, key, guard);
  };
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

export const stringField: FieldReader<string> = requiredReader(isString, STRING_FALLBACK);
export const numberField: FieldReader<number> = requiredReader(isNumber, NUMBER_FALLBACK);
export const boolField: FieldReader<boolean> = requiredReader(isBoolean, BOOLEAN_FALLBACK);
export const nullableStringField: NullableFieldReader<string> = nullableReader(isString);
export const nullableNumberField: NullableFieldReader<number> = nullableReader(isNumber);
export const nullableBoolField: NullableFieldReader<boolean> = nullableReader(isBoolean);

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
