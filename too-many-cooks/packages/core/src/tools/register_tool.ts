/// Register tool - agent registration and reconnection.

import type { Logger } from "../logger.js";
import type { NotificationEmitter } from "../notifications.js";
import {
  EVENT_AGENT_ACTIVATED,
  EVENT_AGENT_REGISTERED,
} from "../notifications.js";
import type { TooManyCooksDb } from "../db-interface.js";
import type { Result } from "../result.js";
import type { AgentRegistration, DbError } from "../types.js";
import { agentRegistrationToJson, dbErrorToJson } from "../types.js";
import {
  type CallToolResult,
  type SessionSetter,
  type ToolCallback,
  textContent,
} from "../mcp-types.js";
import { errorContent } from "./tool_utils.js";

/** Input schema for register tool. */
export const REGISTER_INPUT_SCHEMA: {
  readonly type: "object";
  readonly properties: {
    readonly name: { readonly type: "string"; readonly description: string };
    readonly key: { readonly type: "string"; readonly description: string };
  };
} = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description:
        "Your unique agent name, 1-50 chars. " +
        "For FIRST registration only. Do NOT send with key.",
    },
    key: {
      type: "string",
      description:
        "Your secret key from a previous registration. " +
        "For RECONNECT only. Do NOT send with name.",
    },
  },
} as const;

/** Tool config for register. */
export const REGISTER_TOOL_CONFIG: {
  readonly title: string;
  readonly description: string;
  readonly inputSchema: typeof REGISTER_INPUT_SCHEMA;
  readonly outputSchema: null;
  readonly annotations: null;
} = {
  title: "Register Agent",
  description:
    "Register a new agent or reconnect with an existing key. " +
    'FIRST TIME: pass "name" only. Returns key \u2014 store it! ' +
    'RECONNECT: pass "key" only. Server looks up your name. ' +
    "Passing both name and key is an error. " +
    'Example first: {"name": "my-agent"} ' +
    'Example reconnect: {"key": "abc123..."}',
  inputSchema: REGISTER_INPUT_SCHEMA,
  outputSchema: null,
  annotations: null,
} as const;

// ---------------------------------------------------------------------------
// Reconnect handler
// ---------------------------------------------------------------------------

const handleReconnect: (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  setSession: SessionSetter,
  keyArg: string,
) => Promise<CallToolResult> = async (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  setSession: SessionSetter,
  keyArg: string,
): Promise<CallToolResult> => {
  const lookupResult: Result<string, DbError> = await db.lookupByKey(keyArg);
  if (!lookupResult.ok) {
    log.warn(`Reconnect failed: ${lookupResult.error.code}`);
    return {
      content: [
        textContent(JSON.stringify(dbErrorToJson(lookupResult.error))),
      ],
      isError: true,
    };
  }
  setSession(lookupResult.value, keyArg);
  await db.activate(lookupResult.value);
  emitter.emit(EVENT_AGENT_ACTIVATED, {
    agent_name: lookupResult.value,
  });
  log.info(`Agent reconnected: ${lookupResult.value}`);
  return {
    content: [
      textContent(
        JSON.stringify({
          agent_name: lookupResult.value,
          agent_key: keyArg,
        }),
      ),
    ],
    isError: false,
  };
};

// ---------------------------------------------------------------------------
// First registration handler
// ---------------------------------------------------------------------------

const handleFirstRegistration: (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  setSession: SessionSetter,
  nameArg: string,
) => Promise<CallToolResult> = async (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  setSession: SessionSetter,
  nameArg: string,
): Promise<CallToolResult> => {
  let reg: Result<AgentRegistration, DbError> = await db.register(nameArg);

  if (!reg.ok && reg.error.message.includes("already registered")) {
    const resetResult: Result<AgentRegistration, DbError> = await db.adminResetKey(nameArg);
    if (!resetResult.ok) {
      log.warn(`Re-registration failed: ${resetResult.error.code}`);
      return {
        content: [
          textContent(JSON.stringify(dbErrorToJson(resetResult.error))),
        ],
        isError: true,
      };
    }
    reg = resetResult;
  }

  if (!reg.ok) {
    log.warn(`Registration failed: ${reg.error.code}`);
    return {
      content: [textContent(JSON.stringify(dbErrorToJson(reg.error)))],
      isError: true,
    };
  }

  setSession(reg.value.agentName, reg.value.agentKey);
  await db.activate(reg.value.agentName);
  emitter.emit(EVENT_AGENT_REGISTERED, {
    agent_name: reg.value.agentName,
    registered_at: Date.now(),
  });
  log.info(`Agent registered: ${reg.value.agentName}`);
  return {
    content: [
      textContent(JSON.stringify(agentRegistrationToJson(reg.value))),
    ],
    isError: false,
  };
};

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

type RegisterInputReconnect = { readonly mode: "reconnect"; readonly keyArg: string };
type RegisterInputNew = { readonly mode: "new"; readonly nameArg: string };
type RegisterInputError = { readonly mode: "error"; readonly result: CallToolResult };

const extractNonEmptyString: (value: unknown) => string | null = (value: unknown): string | null =>
  {return typeof value === "string" && value.length > 0 ? value : null};

const parseRegisterArgs: (
  args: Record<string, unknown>,
) => RegisterInputError | RegisterInputNew | RegisterInputReconnect = (
  args: Record<string, unknown>,
): RegisterInputError | RegisterInputNew | RegisterInputReconnect => {
  const nameArg: string | null = extractNonEmptyString(args.name);
  const keyArg: string | null = extractNonEmptyString(args.key);

  if (nameArg !== null && keyArg !== null) {
    return { mode: "error", result: errorContent("validation: pass name OR key, not both") };
  }
  if (nameArg === null && keyArg === null) {
    return { mode: "error", result: errorContent("missing_parameter: name or key required") };
  }
  if (keyArg !== null) {
    return { mode: "reconnect", keyArg };
  }
  if (nameArg === null) {
    return { mode: "error", result: errorContent("missing_parameter: name required") };
  }
  return { mode: "new", nameArg };
};

/** Create register tool handler. */
export const createRegisterHandler: (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  logger: Logger,
  setSession: SessionSetter,
) => ToolCallback = (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  logger: Logger,
  setSession: SessionSetter,
): ToolCallback =>
  {return async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const parsed: RegisterInputError | RegisterInputNew | RegisterInputReconnect = parseRegisterArgs(args);

    if (parsed.mode === "error") {
      return parsed.result;
    }
    if (parsed.mode === "reconnect") {
      const log: Logger = logger.child({ tool: "register", mode: "reconnect" });
      return await handleReconnect(db, emitter, log, setSession, parsed.keyArg);
    }

    const log: Logger = logger.child({ tool: "register", agentName: parsed.nameArg });
    return await handleFirstRegistration(db, emitter, log, setSession, parsed.nameArg);
  }};
