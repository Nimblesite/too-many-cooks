/// Lock tool - file lock management.

import type { Logger } from "../logger.js";
import type { NotificationEmitter } from "../notifications.js";
import {
  EVENT_LOCK_ACQUIRED,
  EVENT_LOCK_RELEASED,
  EVENT_LOCK_RENEWED,
} from "../notifications.js";
import type { TooManyCooksDataConfig } from "../data/data.js";
import {
  type TooManyCooksDb,
  fileLockToJson,
  lockResultToJson,
} from "../data/data.js";
import { textContent, type SessionGetter, type CallToolResult, type ToolCallback } from "../types.js";
import { resolveIdentity, makeErrorResult, errorContent } from "./tool_utils.js";

/** Input schema for lock tool. */
export const LOCK_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["acquire", "release", "force_release", "renew", "query", "list"],
      description: "Lock action to perform",
    },
    file_path: {
      type: "string",
      description: "File path to lock (required except for list)",
    },
    reason: {
      type: "string",
      description: "Why you need this lock (optional, for acquire)",
    },
  },
  required: ["action"],
} as const;

/** Tool config for lock. */
export const LOCK_TOOL_CONFIG = {
  title: "File Lock",
  description:
    "Manage file locks. You must register first. " +
    "REQUIRED: action (acquire|release|force_release|renew|query|list). " +
    "For acquire/release/renew: file_path. For query: file_path. " +
    'Example: {"action":"acquire","file_path":"/path/file.dart",' +
    ' "reason":"editing"}',
  inputSchema: LOCK_INPUT_SCHEMA,
  outputSchema: null,
  annotations: null,
} as const;

/** Create lock tool handler. */
export const createLockHandler = (
  db: TooManyCooksDb,
  config: TooManyCooksDataConfig,
  emitter: NotificationEmitter,
  logger: Logger,
  getSession: SessionGetter,
): ToolCallback =>
  async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const actionArg = args.action;
    if (typeof actionArg !== "string") {
      return await Promise.resolve(errorContent("missing_parameter: action is required"));
    }
    const action = actionArg;
    const filePath = typeof args.file_path === "string" ? args.file_path : null;
    const reason = typeof args.reason === "string" ? args.reason : null;
    const log = logger.child({
      tool: "lock",
      action,
      ...(filePath === null ? {} : { filePath }),
    });

    if (action === "query") {return await Promise.resolve(handleQuery(db, filePath));}
    if (action === "list") {return await Promise.resolve(handleList(db));}

    const identity = resolveIdentity(db, args, getSession);
    if (identity.isError) {return await Promise.resolve(identity.result);}
    const { agentName, agentKey } = identity;

    return await Promise.resolve(dispatchAction({
      action, db, emitter, log, filePath, agentName, agentKey, reason, lockTimeoutMs: config.lockTimeoutMs,
    }));
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

const dispatchAction = (params: DispatchParams): CallToolResult => {
  const { action, db, emitter, log, filePath, agentName, agentKey, reason, lockTimeoutMs } = params;
  switch (action) {
    case "acquire":
      return handleAcquire({ db, emitter, log, filePath, agentName, agentKey, reason, timeoutMs: lockTimeoutMs });
    case "release":
      return handleRelease(db, emitter, log, filePath, agentName, agentKey);
    case "force_release":
      return handleForceRelease(db, emitter, log, filePath, agentName, agentKey);
    case "renew":
      return handleRenew(db, emitter, log, filePath, agentName, agentKey, lockTimeoutMs);
    default:
      return { content: [textContent(JSON.stringify({ error: `Unknown action: ${action}` }))], isError: true };
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

const handleAcquire = (params: AcquireParams): CallToolResult => {
  const { db, emitter, log, filePath, agentName, agentKey, reason, timeoutMs } = params;
  if (filePath === null) {
    return { content: [textContent(JSON.stringify({ error: "acquire requires file_path" }))], isError: true };
  }
  const result = db.acquireLock(filePath, agentName, agentKey, reason, timeoutMs);
  if (!result.ok) {return makeErrorResult(result.error);}
  if (result.value.acquired) {
    emitter.emit(EVENT_LOCK_ACQUIRED, {
      file_path: filePath,
      agent_name: agentName,
      expires_at: result.value.lock?.expiresAt,
      reason,
    });
    log.info(`Lock acquired on ${filePath} by ${agentName}`);
    return { content: [textContent(JSON.stringify(lockResultToJson(result.value)))], isError: false };
  }
  return { content: [textContent(JSON.stringify(lockResultToJson(result.value)))], isError: true };
};

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

const handleRelease = (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  filePath: string | null,
  agentName: string,
  agentKey: string,
): CallToolResult => {
  if (filePath === null) {
    return { content: [textContent(JSON.stringify({ error: "release requires file_path" }))], isError: true };
  }
  const result = db.releaseLock(filePath, agentName, agentKey);
  if (!result.ok) {return makeErrorResult(result.error);}
  emitter.emit(EVENT_LOCK_RELEASED, { file_path: filePath, agent_name: agentName });
  log.info(`Lock released on ${filePath} by ${agentName}`);
  return { content: [textContent(JSON.stringify({ released: true }))], isError: false };
};

// ---------------------------------------------------------------------------
// Force release
// ---------------------------------------------------------------------------

const handleForceRelease = (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  filePath: string | null,
  agentName: string,
  agentKey: string,
): CallToolResult => {
  if (filePath === null) {
    return { content: [textContent(JSON.stringify({ error: "force_release requires file_path" }))], isError: true };
  }
  const result = db.forceReleaseLock(filePath, agentName, agentKey);
  if (!result.ok) {
    return { content: [textContent(JSON.stringify({ error: result.error.message }))], isError: true };
  }
  emitter.emit(EVENT_LOCK_RELEASED, { file_path: filePath, agent_name: agentName, force: true });
  log.warn(`Lock force-released on ${filePath} by ${agentName}`);
  return { content: [textContent(JSON.stringify({ released: true }))], isError: false };
};

// ---------------------------------------------------------------------------
// Renew
// ---------------------------------------------------------------------------

const handleRenew = (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  filePath: string | null,
  agentName: string,
  agentKey: string,
  timeoutMs: number,
): CallToolResult => {
  if (filePath === null) {
    return { content: [textContent(JSON.stringify({ error: "renew requires file_path" }))], isError: true };
  }
  const result = db.renewLock(filePath, agentName, agentKey, timeoutMs);
  if (!result.ok) {return makeErrorResult(result.error);}
  const newExpiresAt = Date.now() + timeoutMs;
  emitter.emit(EVENT_LOCK_RENEWED, {
    file_path: filePath,
    agent_name: agentName,
    expires_at: newExpiresAt,
  });
  log.debug(`Lock renewed on ${filePath} by ${agentName}`);
  return { content: [textContent(JSON.stringify({ renewed: true }))], isError: false };
};

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const handleQuery = (
  db: TooManyCooksDb,
  filePath: string | null,
): CallToolResult => {
  if (filePath === null) {
    return { content: [textContent(JSON.stringify({ error: "query requires file_path" }))], isError: true };
  }
  const result = db.queryLock(filePath);
  if (!result.ok) {return makeErrorResult(result.error);}
  if (result.value !== null) {
    return { content: [textContent(JSON.stringify({ locked: true, lock: fileLockToJson(result.value) }))], isError: false };
  }
  return { content: [textContent(JSON.stringify({ locked: false }))], isError: false };
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const handleList = (db: TooManyCooksDb): CallToolResult => {
  const result = db.listLocks();
  if (!result.ok) {return makeErrorResult(result.error);}
  return {
    content: [textContent(JSON.stringify({ locks: result.value.map(fileLockToJson) }))],
    isError: false,
  };
};

