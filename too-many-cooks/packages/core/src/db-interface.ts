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
