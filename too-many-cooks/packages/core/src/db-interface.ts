/// Database interface for Too Many Cooks.
///
/// Backend-agnostic contract. Implementations live in @too-many-cooks/local
/// (SQLite for local mode, encrypted cloud client for cloud mode).

import type { Result } from "./result.js";
import type {
  AgentIdentity,
  AgentPlan,
  AgentRegistration,
  DbError,
  FileLock,
  LockResult,
  Message,
} from "./types.js";

/// [STATUS-BOUNDED] Issues #41/#42: a message header carries routing/read
/// metadata only — never the body. The `status` overview returns headers so its
/// payload size is independent of message content length.
export type MessageHeader = {
  readonly id: string;
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly createdAt: number;
  readonly readAt: number | undefined;
};

/// [STATUS-BOUNDED] Issues #41/#42: bounded overview of a caller's inbox. `total`
/// and `unread` are counts (O(1) payload); `recent` is a bounded slice of the
/// caller's most-recent UNREAD inbox headers (own + unread only, no bodies).
export type MessageOverview = {
  readonly total: number;
  readonly unread: number;
  readonly recent: readonly MessageHeader[];
};

/** Data access layer type. */
export type TooManyCooksDb = {
  readonly register: (agentName: string) => Promise<Result<AgentRegistration, DbError>>;
  readonly authenticate: (
    agentName: string,
    agentKey: string,
  ) => Promise<Result<AgentIdentity, DbError>>;
  readonly lookupByKey: (agentKey: string) => Promise<Result<string, DbError>>;
  readonly listAgents: () => Promise<Result<readonly AgentIdentity[], DbError>>;
  readonly acquireLock: (
    filePath: string,
    agentName: string,
    agentKey: string,
    reason: string | null | undefined,
    timeoutMs: number,
  ) => Promise<Result<LockResult, DbError>>;
  readonly releaseLock: (
    filePath: string,
    agentName: string,
    agentKey: string,
  ) => Promise<Result<void, DbError>>;
  readonly forceReleaseLock: (
    filePath: string,
    agentName: string,
    agentKey: string,
  ) => Promise<Result<void, DbError>>;
  readonly queryLock: (
    filePath: string,
  ) => Promise<Result<FileLock | null, DbError>>;
  readonly listLocks: () => Promise<Result<readonly FileLock[], DbError>>;
  readonly renewLock: (
    filePath: string,
    agentName: string,
    agentKey: string,
    timeoutMs: number,
  ) => Promise<Result<void, DbError>>;
  readonly sendMessage: (
    fromAgent: string,
    fromKey: string,
    toAgent: string,
    content: string,
  ) => Promise<Result<string, DbError>>;
  readonly getMessages: (
    agentName: string,
    agentKey: string,
    options?: { readonly unreadOnly?: boolean },
  ) => Promise<Result<readonly Message[], DbError>>;
  readonly markRead: (
    messageId: string,
    agentName: string,
    agentKey: string,
  ) => Promise<Result<void, DbError>>;
  readonly updatePlan: (
    agentName: string,
    agentKey: string,
    goal: string,
    currentTask: string,
  ) => Promise<Result<void, DbError>>;
  readonly getPlan: (
    agentName: string,
  ) => Promise<Result<AgentPlan | null, DbError>>;
  readonly listPlans: () => Promise<Result<readonly AgentPlan[], DbError>>;
  readonly listAllMessages: () => Promise<Result<readonly Message[], DbError>>;
  /// [STATUS-BOUNDED] Issues #41/#42: bounded, SQL-filtered overview for `status`.
  /// `agentName === null` (unresolved caller) sees broadcasts only. No side
  /// effects — unlike getMessages, this never marks anything read.
  readonly getMessageOverview: (
    agentName: string | null,
    limit: number,
  ) => Promise<Result<MessageOverview, DbError>>;
  readonly activate: (agentName: string) => Promise<Result<void, DbError>>;
  readonly deactivate: (agentName: string) => Promise<Result<void, DbError>>;
  readonly deactivateAll: () => Promise<Result<void, DbError>>;
  readonly close: () => Promise<Result<void, DbError>>;
  readonly adminDeleteLock: (filePath: string) => Promise<Result<void, DbError>>;
  readonly adminDeleteAgent: (agentName: string) => Promise<Result<void, DbError>>;
  readonly adminResetKey: (
    agentName: string,
  ) => Promise<Result<AgentRegistration, DbError>>;
  readonly adminSendMessage: (
    fromAgent: string,
    toAgent: string,
    content: string,
  ) => Promise<Result<string, DbError>>;
  readonly adminReset: () => Promise<Result<void, DbError>>;
};
