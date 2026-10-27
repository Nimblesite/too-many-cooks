/// Lock tool - file lock management.

import { z } from "zod";

import type { Logger } from "../logger.js";
import type { NotificationEmitter } from "../notifications.js";
import {
  EVENT_LOCK_ACQUIRED,
  EVENT_LOCK_RELEASED,
  EVENT_LOCK_RENEWED,
} from "../notifications.js";
import type { TooManyCooksDataConfig } from "../config.js";
import type { TooManyCooksDb } from "../db-interface.js";
import type { Result } from "../result.js";
import type { DbError, FileLock, LockResult } from "../types.js";
import { fileLockToJson, lockResultToJson } from "../types.js";
import { type CallToolResult, type SessionGetter, type ToolCallback, textContent } from "../mcp-types.js";
import { actionContext, agentKeyField, errorContent, jsonResult, listJsonResult, makeErrorResult, optionalString, toJsonSchema, toolConfig, unknownActionError, withResolvedAgent } from "./tool_utils.js";
import type { ActionContext } from "./tool_utils.js";

/** Lock tool input — the ONE source of the wire schema. */
export const LOCK_INPUT_SHAPE: z.ZodRawShape = {
  action: z.enum(["acquire", "release", "force_release", "renew", "query", "list"])
    .describe("Lock action to perform"),
  file_path: z.string().optional().describe("File path to lock (required except for list)"),
  reason: z.string().optional().describe("Why you need this lock (optional, for acquire)"),
  agent_key: agentKeyField,
};

/** JSON Schema of the lock input (derived from the zod shape). */
export const LOCK_INPUT_SCHEMA: Record<string, unknown> = toJsonSchema(LOCK_INPUT_SHAPE);

/** Tool config for lock. */
export const LOCK_TOOL_CONFIG = toolConfig(
  "File Lock",
  "Manage file locks. You must register first. " +
    "REQUIRED: action (acquire|release|force_release|renew|query|list). " +
    "For acquire/release/renew: file_path. For query: file_path. " +
    'Example: {"action":"acquire","file_path":"/path/file.dart",' +
    ' "reason":"editing"}',
  LOCK_INPUT_SCHEMA
);

/** Create lock tool handler. */
export const createLockHandler = (
  db: TooManyCooksDb,
  config: TooManyCooksDataConfig,
  emitter: NotificationEmitter,
  logger: Logger,
  getSession: SessionGetter
): ToolCallback => {
  return async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const filePath: string | null = optionalString(args, "file_path");
    const reason: string | null = optionalString(args, "reason");
    const ctx: ActionContext = actionContext(args, logger, "lock", filePath === null ? {} : { filePath });
    if (ctx.isError) {return ctx.result;}

    if (ctx.action === "query") {return await handleQuery(db, filePath);}
    if (ctx.action === "list") {return await handleList(db);}

    return await withResolvedAgent(db, args, getSession, async (agentName: string, agentKey: string): Promise<CallToolResult> =>
      await dispatchAction({ action: ctx.action, db, emitter, log: ctx.log, filePath, agentName, agentKey, reason, lockTimeoutMs: config.lockTimeoutMs }));
  };
};

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

type DispatchParams = {
  readonly action: string;
  readonly db: TooManyCooksDb;
  readonly emitter: NotificationEmitter;
  readonly log: Logger;
  readonly filePath: string | null;
  readonly agentName: string;
  readonly agentKey: string;
  readonly reason: string | null;
  readonly lockTimeoutMs: number;
};

const dispatchAction = async (params: DispatchParams): Promise<CallToolResult> => {
  const { action, db, emitter, log, filePath, agentName, agentKey, reason, lockTimeoutMs }: DispatchParams = params;
  switch (action) {
    case "acquire":
      return await handleAcquire({ db, emitter, log, filePath, agentName, agentKey, reason, timeoutMs: lockTimeoutMs });
    case "release":
      return await handleRelease(db, emitter, log, filePath, agentName, agentKey);
    case "force_release":
      return await handleForceRelease(db, emitter, log, filePath, agentName, agentKey);
    case "renew":
      return await handleRenew(db, emitter, log, filePath, agentName, agentKey, lockTimeoutMs);
    default:
      return unknownActionError(action);
  }
};

// ---------------------------------------------------------------------------
// Acquire
// ---------------------------------------------------------------------------

type AcquireParams = {
  readonly db: TooManyCooksDb;
  readonly emitter: NotificationEmitter;
  readonly log: Logger;
  readonly filePath: string | null;
  readonly agentName: string;
  readonly agentKey: string;
  readonly reason: string | null;
  readonly timeoutMs: number;
};

const handleAcquire = async (params: AcquireParams): Promise<CallToolResult> => {
  const { db, emitter, log, filePath, agentName, agentKey, reason, timeoutMs }: AcquireParams = params;
  if (filePath === null) {
    return errorContent("acquire requires file_path");
  }
  const result: Result<LockResult, DbError> = await db.acquireLock(filePath, agentName, agentKey, reason, timeoutMs);
  if (!result.ok) {return makeErrorResult(result.error);}
  if (result.value.acquired) {
    emitter.emit(EVENT_LOCK_ACQUIRED, {
      file_path: filePath,
      agent_name: agentName,
      expires_at: result.value.lock?.expiresAt,
      reason,
    });
    log.info(`Lock acquired on ${filePath} by ${agentName}`);
    return jsonResult(lockResultToJson(result.value));
  }
  return { content: [textContent(JSON.stringify(lockResultToJson(result.value)))], isError: true };
};

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

const handleRelease = async (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  filePath: string | null,
  agentName: string,
  agentKey: string
): Promise<CallToolResult> => {
  if (filePath === null) {
    return errorContent("release requires file_path");
  }
  const result: Result<void, DbError> = await db.releaseLock(filePath, agentName, agentKey);
  if (!result.ok) {return makeErrorResult(result.error);}
  emitter.emit(EVENT_LOCK_RELEASED, { file_path: filePath, agent_name: agentName });
  log.info(`Lock released on ${filePath} by ${agentName}`);
  return jsonResult({ released: true });
};

// ---------------------------------------------------------------------------
// Force release
// ---------------------------------------------------------------------------

const handleForceRelease = async (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  filePath: string | null,
  agentName: string,
  agentKey: string
): Promise<CallToolResult> => {
  if (filePath === null) {
    return errorContent("force_release requires file_path");
  }
  const result: Result<void, DbError> = await db.forceReleaseLock(filePath, agentName, agentKey);
  if (!result.ok) {
    return errorContent(result.error.message);
  }
  emitter.emit(EVENT_LOCK_RELEASED, { file_path: filePath, agent_name: agentName, force: true });
  log.warn(`Lock force-released on ${filePath} by ${agentName}`);
  return jsonResult({ released: true });
};

// ---------------------------------------------------------------------------
// Renew
// ---------------------------------------------------------------------------

const handleRenew = async (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  filePath: string | null,
  agentName: string,
  agentKey: string,
  timeoutMs: number
): Promise<CallToolResult> => {
  if (filePath === null) {
    return errorContent("renew requires file_path");
  }
  const result: Result<void, DbError> = await db.renewLock(filePath, agentName, agentKey, timeoutMs);
  if (!result.ok) {return makeErrorResult(result.error);}
  const newExpiresAt: number = Date.now() + timeoutMs;
  emitter.emit(EVENT_LOCK_RENEWED, {
    file_path: filePath,
    agent_name: agentName,
    expires_at: newExpiresAt,
  });
  log.debug(`Lock renewed on ${filePath} by ${agentName}`);
  return jsonResult({ renewed: true });
};

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const handleQuery = async (db: TooManyCooksDb, filePath: string | null): Promise<CallToolResult> => {
  if (filePath === null) {
    return errorContent("query requires file_path");
  }
  const result: Result<FileLock | null, DbError> = await db.queryLock(filePath);
  if (!result.ok) {return makeErrorResult(result.error);}
  if (result.value !== null) {
    return jsonResult({ locked: true, lock: fileLockToJson(result.value) });
  }
  return jsonResult({ locked: false });
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const handleList = async (db: TooManyCooksDb): Promise<CallToolResult> => {
  const result: Result<readonly FileLock[], DbError> = await db.listLocks();
  return listJsonResult(result, "locks", fileLockToJson);
};
