/// Shared fixtures for direct tool-handler tests: notification emitter,
/// logger, session plumbing, and tool-result parsing ([DEDUP-DESLOP]).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CallToolResult,
  type Logger,
  type NotificationEmitter,
  type SessionIdentity,
  createLoggerWithContext,
  createLoggingContext,
  createNotificationEmitter,
} from "too-many-cooks-core";

import {
  getNumberField,
  getRecordArrayField,
  getRecordField,
  parseJsonRecord,
} from "./json.js";

const TEST_SERVER_NAME = "test";
const TEST_SERVER_VERSION = "1.0.0";

/** Notification emitter wired to a throwaway in-memory McpServer. */
export const createTestEmitter = (): NotificationEmitter => {
  const server = new McpServer(
    { name: TEST_SERVER_NAME, version: TEST_SERVER_VERSION },
    { capabilities: { tools: { listChanged: false }, logging: {} } },
  );
  return createNotificationEmitter(server);
};

/** Logger with a fresh logging context (no workspace file output). */
export const createTestLogger = (): Logger =>
  createLoggerWithContext(createLoggingContext());

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
