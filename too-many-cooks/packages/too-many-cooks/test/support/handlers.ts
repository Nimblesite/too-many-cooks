/// Shared fixtures for direct tool-handler tests: notification emitter,
/// logger, session plumbing, and tool-result parsing ([DEDUP-DESLOP]).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import assert from "node:assert";
import {
  type CallToolResult,
  BROADCAST_RECIPIENT,
  type Logger,
  type NotificationEmitter,
  type SessionIdentity,
  type SessionGetter,
  type TooManyCooksDb,
  type ToolCallback,
  createLoggerWithContext,
  createLoggingContext,
  createMessageHandler,
  createNotificationEmitter,
  createPlanHandler,
  createRegisterHandler,
  createStatusHandler,
} from "too-many-cooks-core";

import {
  getNumberField,
  getRecordArrayField,
  getRecordField,
  getStringField,
  parseJsonRecord,
} from "./json.js";
import type { RegisteredAgent } from "./db_fixture.js";

const TEST_SERVER_NAME = "test";
const TEST_SERVER_VERSION = "1.0.0";

/** A throwaway McpServer with the tool/logging capabilities tests need. */
export const createTestMcpServer = (): McpServer =>
  new McpServer(
    { name: TEST_SERVER_NAME, version: TEST_SERVER_VERSION },
    { capabilities: { tools: { listChanged: false }, logging: {} } },
  );

/** Notification emitter wired to a throwaway in-memory McpServer. */
export const createTestEmitter = (): NotificationEmitter =>
  createNotificationEmitter(createTestMcpServer());

/** Records the events an emitter pushes on the admin and agent channels. */
export type EventRecorder = {
  readonly adminEvents: string[];
  readonly agentEvents: string[];
  readonly adminPush: (event: string) => void;
  readonly agentPush: (event: string) => void;
};

/** Builds an admin/agent event recorder ([DEDUP-DESLOP]). */
export const createEventRecorder = (): EventRecorder => {
  const adminEvents: string[] = [];
  const agentEvents: string[] = [];
  return {
    adminEvents,
    agentEvents,
    adminPush: (event: string): void => { adminEvents.push(event); },
    agentPush: (event: string): void => { agentEvents.push(event); },
  };
};

/** Logger with a fresh logging context (no workspace file output). */
export const createTestLogger = (): Logger =>
  createLoggerWithContext(createLoggingContext());

/** Session getter that always returns the given agent identity. */
export const agentSession = (agent: RegisteredAgent): SessionGetter =>
  (): SessionIdentity => ({ agentName: agent.agentName, agentKey: agent.agentKey });

/** Session getter that always returns the given name/key pair. */
export const nameKeySession = (agentName: string, agentKey: string): SessionGetter =>
  (): SessionIdentity => ({ agentName, agentKey });

/** Message tool handler bound to a db + session (emitter/logger injected). */
export const messageHandlerFor = (
  db: TooManyCooksDb,
  getSession: SessionGetter,
): ToolCallback =>
  createMessageHandler(db, createTestEmitter(), createTestLogger(), getSession);

/** Plan tool handler bound to a db + session (emitter/logger injected). */
export const planHandlerFor = (
  db: TooManyCooksDb,
  getSession: SessionGetter,
): ToolCallback =>
  createPlanHandler(db, createTestEmitter(), createTestLogger(), getSession);

/** Register tool handler bound to a db + session setter (emitter/logger injected). */
export const registerHandlerFor = (
  db: TooManyCooksDb,
  setSession: (agentName: string, agentKey: string) => void,
): ToolCallback =>
  createRegisterHandler(db, createTestEmitter(), createTestLogger(), setSession);

/** Status payload overview of the caller's inbox ([STATUS-BOUNDED]). */
export type MessagesOverview = {
  readonly total: number;
  readonly unread: number;
  readonly recent: ReadonlyArray<Record<string, unknown>>;
};

/** Returns the text of the first content block; throws when absent. */
export const firstTextBlock = (result: CallToolResult): string => {
  const block = result.content[0];
  if (block === undefined) {
    throw new Error("tool result has no content");
  }
  return block.text;
};

/** Parses the first text content block of a tool result as a JSON record. */
export const parseToolJson = (
  result: CallToolResult,
): Record<string, unknown> => parseJsonRecord(firstTextBlock(result));

/** Parses the JSON body of an error tool result, asserting it is an error. */
export const errorToolJson = (
  result: CallToolResult,
): Record<string, unknown> => {
  assert.strictEqual(result.isError, true);
  return parseToolJson(result);
};

/** Runs a tool callback expecting success; returns the parsed JSON payload. */
export const runToolOk = async (
  callback: ToolCallback,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const result = await callback(args, {});
  assert.strictEqual(result.isError, false);
  return parseToolJson(result);
};

/** Runs a tool callback expecting a tool error; returns the raw result. */
export const runToolErr = async (
  callback: ToolCallback,
  args: Record<string, unknown>,
): Promise<CallToolResult> => {
  const result = await callback(args, {});
  assert.strictEqual(result.isError, true);
  return result;
};

/** Sends a broadcast through `callback`; returns the created message ID. */
export const sendBroadcast = async (
  callback: ToolCallback,
  content: string,
): Promise<string> => {
  const result = await callback(
    { action: "send", to_agent: BROADCAST_RECIPIENT, content },
    {},
  );
  assert.strictEqual(result.isError, false, "broadcast send must succeed");
  return getStringField(parseToolJson(result), "message_id");
};

/** Narrows a status tool result to the caller's inbox overview. */
export const statusMessagesOverview = (
  result: CallToolResult,
): MessagesOverview => {
  const messages = getRecordField(parseToolJson(result), "messages");
  return {
    total: getNumberField(messages, "total"),
    unread: getNumberField(messages, "unread"),
    recent: getRecordArrayField(messages, "recent"),
  };
};

/** Runs the status tool for an agent key and returns the messages overview. */
export const statusOverviewFor = async (
  db: TooManyCooksDb,
  agentKey: string,
): Promise<MessagesOverview> => {
  const handler = createStatusHandler(db, createTestLogger());
  const result = await handler({ agent_key: agentKey }, {});
  assert.strictEqual(result.isError, false, "status must not error");
  return statusMessagesOverview(result);
};

export type SessionCapture = {
  /** Latest identity set through the setter (null until registered). */
  readonly session: () => SessionIdentity | null;
  /** Session setter to pass into the register handler. */
  readonly setSession: (agentName: string, agentKey: string) => void;
};

/** Captures the session identity the register handler sets. */
export const createSessionCapture = (): SessionCapture => {
  let session: SessionIdentity | null = null;
  return {
    session: (): SessionIdentity | null => session,
    setSession: (agentName: string, agentKey: string): void => {
      session = { agentName, agentKey };
    },
  };
};
