/// Named TooManyCooksDb method groups.
///
/// The SQLite ops builders, the cloud client and the encryption middleware all
/// compose the same subsets of the interface; naming each group once here stops
/// the Pick<...> unions being repeated in every backend.

import type { TooManyCooksDb } from "too-many-cooks-core";

/** Agent identity + lifecycle methods. */
export type AgentMethodGroup = Pick<
  TooManyCooksDb,
  "activate" | "authenticate" | "deactivate" | "deactivateAll" | "listAgents" | "lookupByKey" | "register"
>;

/** Connection lifecycle method. */
export type CloseMethodGroup = Pick<TooManyCooksDb, "close">;

/** File lock methods. */
export type LockMethodGroup = Pick<
  TooManyCooksDb,
  "acquireLock" | "forceReleaseLock" | "listLocks" | "queryLock" | "releaseLock" | "renewLock"
>;

/** Messaging methods. */
export type MessageMethodGroup = Pick<
  TooManyCooksDb,
  "getMessageOverview" | "getMessages" | "listAllMessages" | "markRead" | "sendMessage"
>;

/** Plan methods. */
export type PlanMethodGroup = Pick<TooManyCooksDb, "getPlan" | "listPlans" | "updatePlan">;

/** Admin methods. */
export type AdminMethodGroup = Pick<
  TooManyCooksDb,
  "adminDeleteAgent" | "adminDeleteLock" | "adminReset" | "adminResetKey" | "adminSendMessage"
>;
