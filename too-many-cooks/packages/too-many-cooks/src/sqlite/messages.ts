/// SQLite message operations: send, fetch, mark-read and the bounded overview.

import type Database from "better-sqlite3";

import {
  type DbError,
  ERR_DATABASE,
  ERR_NOT_FOUND,
  type Logger,
  type Message,
  type MessageOverview,
  type Result,
  type TooManyCooksDataConfig,
  error,
  messageFromJson,
  success,
} from "too-many-cooks-core";

import { messageHeaderFromJson } from "../json-guards.js";
import type { MessageMethodGroup } from "../db-method-groups.js";
import {
  BROADCAST_RECIPIENT,
  asyncDbOp,
  attempt,
  authenticated,
  listAll,
  newMessageId,
  now,
  runOrMiss,
  toRow,
  toRows,
  validateContentLength,
} from "./shared.js";

/** Insert a message row. */
const SQL_INSERT_MESSAGE: string =
  "INSERT INTO messages (id, from_agent, to_agent, content, created_at) VALUES (?, ?, ?, ?, ?)";

/** Record a broadcast read receipt. */
const SQL_INSERT_BROADCAST_READ: string =
  "INSERT OR IGNORE INTO message_reads (message_id, agent_name, read_at) VALUES (?, ?, ?)";

/** Mark a direct message read (only for its recipient). */
const SQL_MARK_DIRECT_READ: string = "UPDATE messages SET read_at = ? WHERE id = ? AND to_agent = ?";

/** Read a message's recipient. */
const SQL_GET_RECIPIENT: string = "SELECT to_agent FROM messages WHERE id = ?";

/// [MSG-AUTO-READ] A caller's unread inbox, direct + broadcast.
const SQL_UNREAD_FOR_AGENT: string = `SELECT m.* FROM messages m
       WHERE (m.to_agent = ? AND m.read_at IS NULL)
          OR (m.to_agent = '*'
              AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.agent_name = ?))
       ORDER BY m.created_at DESC`;

/// [MSG-AUTO-READ] Every message visible to a caller.
const SQL_VISIBLE_FOR_AGENT: string =
  "SELECT * FROM messages WHERE (to_agent = ? OR to_agent = '*') ORDER BY created_at DESC";

/// [STATUS-BOUNDED] List every message, newest first.
const SQL_LIST_ALL_MESSAGES: string = "SELECT * FROM messages ORDER BY created_at DESC";

/// [STATUS-BOUNDED] Issues #41/#42: columns for a message header — never `content`.
const MESSAGE_HEADER_COLUMNS: string = "id, from_agent, to_agent, created_at, read_at";

/// [STATUS-BOUNDED] Predicate: every message visible to a named caller (own
/// inbox, own sent, and broadcasts). Params: [agentName, agentName, '*'].
const VISIBLE_TO_AGENT_WHERE: string = "to_agent = ? OR from_agent = ? OR to_agent = ?";

/// [STATUS-BOUNDED] Predicate: a named caller's UNREAD inbox — mirrors the
/// getMessages unreadOnly query. Params: [agentName, '*', agentName].
const UNREAD_FOR_AGENT_WHERE: string =
  "(to_agent = ? AND read_at IS NULL) OR (to_agent = ? AND NOT EXISTS " +
  "(SELECT 1 FROM message_reads mr WHERE mr.message_id = messages.id AND mr.agent_name = ?))";

/** Insert a message row and return its id. Shared by sendMessage/adminSendMessage. */
export const insertMessage = (
  db: Database.Database,
  msgId: string,
  fromAgent: string,
  toAgent: string,
  content: string,
  timestamp: number
): Result<string, DbError> => {
  return attempt((): Result<string, DbError> => {
    db.prepare(SQL_INSERT_MESSAGE).run(msgId, fromAgent, toAgent, content, timestamp);
    return success(msgId);
  });
};

/** Send a message between agents. */
const sendMessage = (
  db: Database.Database,
  log: Logger,
  fromAgent: string,
  fromKey: string,
  toAgent: string,
  content: string,
  maxLen: number
): Result<string, DbError> => {
  log.debug(`Sending message from ${fromAgent} to ${toAgent}`);
  return authenticated(db, fromAgent, fromKey, (): Result<string, DbError> =>
    composeMessage(db, fromAgent, toAgent, content, maxLen)
  );
};

/** Validate then insert a message row. */
const composeMessage = (
  db: Database.Database,
  fromAgent: string,
  toAgent: string,
  content: string,
  maxLen: number
): Result<string, DbError> => {
  const valid: Result<void, DbError> = validateContentLength(content, maxLen);
  if (!valid.ok) {
    return valid;
  }
  return insertMessage(db, newMessageId(), fromAgent, toAgent, content, now());
};

/** [MSG-AUTO-READ] Run one read-marking statement for a message. */
const runMarkRead = (
  directStmt: Database.Statement,
  broadcastStmt: Database.Statement,
  agentName: string,
  msg: Message,
  timestamp: number
): void => {
  if (msg.toAgent === BROADCAST_RECIPIENT) {
    broadcastStmt.run(msg.id, agentName, timestamp);
    return;
  }
  directStmt.run(timestamp, msg.id, agentName);
};

/** Auto-mark fetched messages as read. Direct messages update read_at;
 *  broadcasts insert into message_reads. Failures are logged, never thrown. */
const autoMarkRead = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  messages: readonly Message[]
): void => {
  const unread: readonly Message[] = messages.filter((msg: Message): boolean => msg.readAt === undefined);
  if (unread.length === 0) {
    return;
  }
  const timestamp: number = now();
  try {
    const directStmt: Database.Statement = db.prepare(SQL_MARK_DIRECT_READ);
    const broadcastStmt: Database.Statement = db.prepare(SQL_INSERT_BROADCAST_READ);
    for (const msg of unread) {
      try {
        runMarkRead(directStmt, broadcastStmt, agentName, msg, timestamp);
      } catch (innerErr: unknown) {
        log.warn(`Failed to mark message ${msg.id} as read: ${String(innerErr)}`);
      }
    }
    log.debug(`Auto-marked ${String(unread.length)} messages as read for ${agentName}`);
  } catch (e: unknown) {
    log.warn(`Failed to auto-mark messages read: ${String(e)}`);
  }
};

/** Get messages for an agent. */
const getMessages = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  agentKey: string,
  unreadOnly: boolean
): Result<readonly Message[], DbError> => {
  log.trace(`Getting messages for ${agentName} (unreadOnly: ${String(unreadOnly)})`);
  return authenticated(db, agentName, agentKey, (): Result<readonly Message[], DbError> =>
    attempt((): Result<readonly Message[], DbError> => fetchMessages(db, log, agentName, unreadOnly))
  );
};

/** Run the inbox query and auto-mark the fetched messages read. */
const fetchMessages = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  unreadOnly: boolean
): Result<readonly Message[], DbError> => {
  const sql: string = unreadOnly ? SQL_UNREAD_FOR_AGENT : SQL_VISIBLE_FOR_AGENT;
  const params: string[] = unreadOnly ? [agentName, agentName] : [agentName];
  const messageList: Message[] = toRows(db.prepare(sql).all(...params)).map(messageFromJson);
  autoMarkRead(db, log, agentName, messageList);
  return success(messageList);
};

/** Mark one read: broadcasts insert a receipt, direct messages set read_at. */
const recordRead = (
  db: Database.Database,
  messageId: string,
  toAgent: string,
  agentName: string
): Result<void, DbError> => {
  if (toAgent === BROADCAST_RECIPIENT) {
    return attempt((): Result<void, DbError> => {
      db.prepare(SQL_INSERT_BROADCAST_READ).run(messageId, agentName, now());
      return success(undefined);
    });
  }
  return markDirectRead(db, messageId, agentName);
};

/** Set read_at on a direct message owned by the caller. */
const markDirectRead = (db: Database.Database, messageId: string, agentName: string): Result<void, DbError> => {
  return attempt((): Result<void, DbError> =>
    runOrMiss(db.prepare(SQL_MARK_DIRECT_READ), [now(), messageId, agentName], {
      code: ERR_NOT_FOUND,
      message: "Message not found",
    })
  );
};

/** Look up the recipient and mark the message read for the caller. */
const markMessageRead = (db: Database.Database, messageId: string, agentName: string): Result<void, DbError> => {
  const row: Record<string, unknown> | undefined = toRow(db.prepare(SQL_GET_RECIPIENT).get(messageId));
  if (row === undefined) {
    return error({ code: ERR_NOT_FOUND, message: "Message not found" });
  }
  const toAgent: unknown = row.to_agent;
  return typeof toAgent === "string"
    ? recordRead(db, messageId, toAgent, agentName)
    : error({ code: ERR_DATABASE, message: "Invalid to_agent in message" });
};

/** Mark a message as read. */
const markRead = (
  db: Database.Database,
  log: Logger,
  messageId: string,
  agentName: string,
  agentKey: string
): Result<void, DbError> => {
  log.trace(`Marking message ${messageId} as read for ${agentName}`);
  return authenticated(db, agentName, agentKey, (): Result<void, DbError> =>
    attempt((): Result<void, DbError> => markMessageRead(db, messageId, agentName))
  );
};

/** List all messages. */
const listAllMessages = (db: Database.Database, log: Logger): Result<readonly Message[], DbError> =>
  listAll(db, log, SQL_LIST_ALL_MESSAGES, messageFromJson, "messages");

/** Run a COUNT(*) query returning column `c` and narrow it to a number. */
const countRows = (db: Database.Database, sql: string, params: ReadonlyArray<number | string>): number => {
  const row: Record<string, unknown> | undefined = toRow(db.prepare(sql).get(...params));
  return typeof row?.c === "number" ? row.c : 0;
};

/// [STATUS-BOUNDED] Overview for a named caller: total visible, unread inbox
/// count, and a bounded slice of recent unread inbox headers.
const agentMessageOverview = (db: Database.Database, agentName: string, limit: number): MessageOverview => {
  const total: number = countRows(db, `SELECT COUNT(*) AS c FROM messages WHERE ${VISIBLE_TO_AGENT_WHERE}`, [
    agentName,
    agentName,
    BROADCAST_RECIPIENT,
  ]);
  const unread: number = countRows(db, `SELECT COUNT(*) AS c FROM messages WHERE ${UNREAD_FOR_AGENT_WHERE}`, [
    agentName,
    BROADCAST_RECIPIENT,
    agentName,
  ]);
  const sql: string =
    `SELECT ${MESSAGE_HEADER_COLUMNS} FROM messages WHERE ${UNREAD_FOR_AGENT_WHERE}` +
    " ORDER BY created_at DESC LIMIT ?";
  const rows: ReadonlyArray<Record<string, unknown>> = toRows(
    db.prepare(sql).all(agentName, BROADCAST_RECIPIENT, agentName, limit)
  );
  return { total, unread, recent: rows.map(messageHeaderFromJson) };
};

/// [STATUS-BOUNDED] Overview for an unresolved caller: broadcasts only. Reads
/// cannot be tracked without an identity, so every broadcast counts as unread.
const broadcastMessageOverview = (db: Database.Database, limit: number): MessageOverview => {
  const total: number = countRows(db, "SELECT COUNT(*) AS c FROM messages WHERE to_agent = ?", [BROADCAST_RECIPIENT]);
  const sql: string = `SELECT ${MESSAGE_HEADER_COLUMNS} FROM messages WHERE to_agent = ? ORDER BY created_at DESC LIMIT ?`;
  const rows: ReadonlyArray<Record<string, unknown>> = toRows(db.prepare(sql).all(BROADCAST_RECIPIENT, limit));
  return { total, unread: total, recent: rows.map(messageHeaderFromJson) };
};

/// [STATUS-BOUNDED] Issues #41/#42: bounded, SQL-filtered inbox overview. No
/// auto-mark-read side effect — `status` is a read-only overview.
const getMessageOverview = (
  db: Database.Database,
  log: Logger,
  agentName: string | null,
  limit: number
): Result<MessageOverview, DbError> => {
  log.trace(`Building message overview (caller: ${agentName ?? "anonymous"})`);
  return attempt((): Result<MessageOverview, DbError> =>
    success(agentName === null ? broadcastMessageOverview(db, limit) : agentMessageOverview(db, agentName, limit))
  );
};

/** Build message operations. */
export const createMessageOps = (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig
): MessageMethodGroup => ({
  getMessages: async (
    name: string,
    key: string,
    options?: { unreadOnly?: boolean }
  ): Promise<Result<readonly Message[], DbError>> =>
    await Promise.resolve(getMessages(db, log, name, key, options?.unreadOnly ?? true)),
  getMessageOverview: asyncDbOp(getMessageOverview, db, log),
  listAllMessages: asyncDbOp(listAllMessages, db, log),
  markRead: asyncDbOp(markRead, db, log),
  sendMessage: async (from: string, key: string, to: string, content: string): Promise<Result<string, DbError>> =>
    await Promise.resolve(sendMessage(db, log, from, key, to, content, config.maxMessageLength)),
});
