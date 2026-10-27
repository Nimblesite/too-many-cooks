/// Shared in-memory `TooManyCooksDb` fixture ([DEDUP-DESLOP]).
///
/// The encryption test files each re-declared the full 27-method db
/// interface with a "not implemented" throw for every method their
/// fixture did not exercise. This factory builds that base once;
/// callers spread only the methods their fixture implements. Pure
/// plumbing — no assertions.

import type { TooManyCooksDb } from "too-many-cooks-core";

const NOT_IMPLEMENTED_MESSAGE = "Not implemented in mock";

/** Sentinel throw for db methods a fixture does not exercise. */
const notImplemented = (): never => {
  throw new Error(NOT_IMPLEMENTED_MESSAGE);
};

/** Builds an in-memory db where every method throws by default; callers
 * override the methods their test exercises via `overrides`. */
export const createInMemoryDb = (
  overrides: Partial<TooManyCooksDb>,
): TooManyCooksDb => {
  const base: TooManyCooksDb = {
    register: notImplemented,
    authenticate: notImplemented,
    lookupByKey: notImplemented,
    listAgents: notImplemented,
    acquireLock: notImplemented,
    releaseLock: notImplemented,
    forceReleaseLock: notImplemented,
    queryLock: notImplemented,
    listLocks: notImplemented,
    renewLock: notImplemented,
    sendMessage: notImplemented,
    getMessages: notImplemented,
    markRead: notImplemented,
    updatePlan: notImplemented,
    getPlan: notImplemented,
    listPlans: notImplemented,
    listAllMessages: notImplemented,
    getMessageOverview: notImplemented,
    activate: notImplemented,
    deactivate: notImplemented,
    deactivateAll: notImplemented,
    close: notImplemented,
    adminDeleteLock: notImplemented,
    adminDeleteAgent: notImplemented,
    adminResetKey: notImplemented,
    adminSendMessage: notImplemented,
    adminReset: notImplemented,
  };
  return { ...base, ...overrides };
};
