/// Encryption middleware for TooManyCooksDb.
///
/// Wraps a TooManyCooksDb instance, encrypting content fields on the way out
/// and decrypting them on the way in. Agent names/IDs stay plaintext.
///
/// Encrypted fields: lock.reason, message.content, plan.goal, plan.currentTask

import type {
  AgentIdentity,
  AgentPlan,
  AgentRegistration,
  DbError,
  FileLock,
  LockResult,
  Message,
  Result,
  TooManyCooksDb,
} from "@too-many-cooks/core";
import { error, success } from "@too-many-cooks/core";

import type { Keychain, WorkspaceKey } from "./crypto.js";
import { decrypt, encrypt } from "./crypto.js";

/** Error code when decryption fails. */
const ERR_DECRYPTION_FAILED: string = "DECRYPTION_FAILED";

/** Encrypt a nullable/optional string field. */
const encryptField: (
  value: string | null | undefined,
  wk: WorkspaceKey,
) => string | null | undefined = (
  value: string | null | undefined,
  wk: WorkspaceKey,
): string | null | undefined =>
  {return value === null || value === undefined ? value : encrypt(value, wk)};

/** Decrypt a nullable string field, returning Result. */
const decryptField: (
  value: string | null,
  keychain: Keychain,
) => Result<string | null, string> = (
  value: string | null,
  keychain: Keychain,
): Result<string | null, string> => {
  if (value === null) {return success(null);}
  return decrypt(value, keychain);
};

/** Decrypt a string field (non-nullable), returning Result. */
const decryptRequired: (
  value: string,
  keychain: Keychain,
) => Result<string, string> = (
  value: string,
  keychain: Keychain,
): Result<string, string> => {return decrypt(value, keychain)};

/** Decrypt a FileLock's reason field. */
const decryptLock: (
  lock: FileLock,
  keychain: Keychain,
) => Result<FileLock, string> = (
  lock: FileLock,
  keychain: Keychain,
): Result<FileLock, string> => {
  const reasonResult: Result<string | null, string> = decryptField(lock.reason, keychain);
  return reasonResult.ok
    ? success({ ...lock, reason: reasonResult.value })
    : error(reasonResult.error);
};

/** Decrypt a LockResult's nested lock reason. */
const decryptLockResult: (
  lr: LockResult,
  keychain: Keychain,
) => Result<LockResult, string> = (
  lr: LockResult,
  keychain: Keychain,
): Result<LockResult, string> => {
  if (lr.lock === undefined) {return success(lr);}
  const lockResult: Result<FileLock, string> = decryptLock(lr.lock, keychain);
  return lockResult.ok
    ? success({ ...lr, lock: lockResult.value })
    : error(lockResult.error);
};

/** Decrypt a Message's content field. */
const decryptMessage: (
  msg: Message,
  keychain: Keychain,
) => Result<Message, string> = (
  msg: Message,
  keychain: Keychain,
): Result<Message, string> => {
  const contentResult: Result<string, string> = decryptRequired(msg.content, keychain);
  return contentResult.ok
    ? success({ ...msg, content: contentResult.value })
    : error(contentResult.error);
};

/** Decrypt an AgentPlan's goal and currentTask fields. */
const decryptPlan: (
  plan: AgentPlan,
  keychain: Keychain,
) => Result<AgentPlan, string> = (
  plan: AgentPlan,
  keychain: Keychain,
): Result<AgentPlan, string> => {
  const goalResult: Result<string, string> = decryptRequired(plan.goal, keychain);
  if (!goalResult.ok) {return error(goalResult.error);}
  const taskResult: Result<string, string> = decryptRequired(plan.currentTask, keychain);
  return taskResult.ok
    ? success({
      ...plan,
      goal: goalResult.value,
      currentTask: taskResult.value,
    })
    : error(taskResult.error);
};

/** Decrypt all items in a readonly array using a mapper. */
const decryptArray: <T>(
  items: readonly T[],
  keychain: Keychain,
  mapper: (item: T, kc: Keychain) => Result<T, string>,
) => Result<readonly T[], string> = <T>(
  items: readonly T[],
  keychain: Keychain,
  mapper: (item: T, kc: Keychain) => Result<T, string>,
): Result<readonly T[], string> => {
  const results: T[] = [];
  for (const item of items) {
    const mapped: Result<T, string> = mapper(item, keychain);
    if (!mapped.ok) {return error(mapped.error);}
    results.push(mapped.value);
  }
  return success(results);
};

/** Convert a crypto error to a DbError result. */
const toDbError: <T>(
  result: Result<T, string>,
) => Result<T, DbError> = <T>(
  result: Result<T, string>,
): Result<T, DbError> =>
  {return result.ok
    ? success(result.value)
    : error({ code: ERR_DECRYPTION_FAILED, message: result.error })};

/** Wrap a db Result through a decryption transform. */
const mapDbResult: <T>(
  dbResult: Promise<Result<T, DbError>>,
  transform: (value: T, kc: Keychain) => Result<T, string>,
  keychain: Keychain,
) => Promise<Result<T, DbError>> = async <T>(
  dbResult: Promise<Result<T, DbError>>,
  transform: (value: T, kc: Keychain) => Result<T, string>,
  keychain: Keychain,
): Promise<Result<T, DbError>> => {
  const result: Result<T, DbError> = await dbResult;
  if (!result.ok) {return result;}
  return toDbError(transform(result.value, keychain));
};

/** Create an encrypting wrapper around a TooManyCooksDb. */
export const withEncryption: (
  db: TooManyCooksDb,
  currentKey: WorkspaceKey,
  keychain: Keychain,
) => TooManyCooksDb =
// eslint-disable-next-line max-lines-per-function -- single object literal implementing full TooManyCooksDb interface
(
  db: TooManyCooksDb,
  currentKey: WorkspaceKey,
  keychain: Keychain,
): TooManyCooksDb => {return {
  register: async (agentName: string): Promise<Result<AgentRegistration, DbError>> => {return await db.register(agentName)},
  authenticate: async (name: string, key: string): Promise<Result<AgentIdentity, DbError>> => {return await db.authenticate(name, key)},
  lookupByKey: async (key: string): Promise<Result<string, DbError>> => {return await db.lookupByKey(key)},
  listAgents: async (): Promise<Result<readonly AgentIdentity[], DbError>> => {return await db.listAgents()},
  acquireLock: async (fp: string, an: string, ak: string, reason: string | null | undefined, timeout: number): Promise<Result<LockResult, DbError>> =>
    {return await mapDbResult(
      db.acquireLock(fp, an, ak, encryptField(reason, currentKey), timeout),
      decryptLockResult,
      keychain,
    )},
  releaseLock: async (fp: string, an: string, ak: string): Promise<Result<void, DbError>> => {return await db.releaseLock(fp, an, ak)},
  forceReleaseLock: async (fp: string, an: string, ak: string): Promise<Result<void, DbError>> => {return await db.forceReleaseLock(fp, an, ak)},
  queryLock: async (fp: string): Promise<Result<FileLock | null, DbError>> => {
    const result: Result<FileLock | null, DbError> = await db.queryLock(fp);
    if (!result.ok || result.value === null) {return result;}
    return toDbError(decryptLock(result.value, keychain));
  },
  listLocks: async (): Promise<Result<readonly FileLock[], DbError>> =>
    {return await mapDbResult(
      db.listLocks(),
      (locks: readonly FileLock[], kc: Keychain): Result<readonly FileLock[], string> => {return decryptArray(locks, kc, decryptLock)},
      keychain,
    )},
  renewLock: async (fp: string, an: string, ak: string, timeoutMs: number): Promise<Result<void, DbError>> => {return await db.renewLock(fp, an, ak, timeoutMs)},
  sendMessage: async (from: string, key: string, to: string, content: string): Promise<Result<string, DbError>> =>
    {return await db.sendMessage(from, key, to, encrypt(content, currentKey))},
  getMessages: async (an: string, ak: string, opts?: { readonly unreadOnly?: boolean }): Promise<Result<readonly Message[], DbError>> =>
    {return await mapDbResult(
      db.getMessages(an, ak, opts),
      (msgs: readonly Message[], kc: Keychain): Result<readonly Message[], string> => {return decryptArray(msgs, kc, decryptMessage)},
      keychain,
    )},
  markRead: async (id: string, an: string, ak: string): Promise<Result<void, DbError>> => {return await db.markRead(id, an, ak)},
  updatePlan: async (an: string, ak: string, goal: string, task: string): Promise<Result<void, DbError>> =>
    {return await db.updatePlan(
      an,
      ak,
      encrypt(goal, currentKey),
      encrypt(task, currentKey),
    )},
  getPlan: async (an: string): Promise<Result<AgentPlan | null, DbError>> => {
    const result: Result<AgentPlan | null, DbError> = await db.getPlan(an);
    if (!result.ok || result.value === null) {return result;}
    return toDbError(decryptPlan(result.value, keychain));
  },
  listPlans: async (): Promise<Result<readonly AgentPlan[], DbError>> =>
    {return await mapDbResult(
      db.listPlans(),
      (plans: readonly AgentPlan[], kc: Keychain): Result<readonly AgentPlan[], string> => {return decryptArray(plans, kc, decryptPlan)},
      keychain,
    )},
  listAllMessages: async (): Promise<Result<readonly Message[], DbError>> =>
    {return await mapDbResult(
      db.listAllMessages(),
      (msgs: readonly Message[], kc: Keychain): Result<readonly Message[], string> => {return decryptArray(msgs, kc, decryptMessage)},
      keychain,
    )},
  activate: async (an: string): Promise<Result<void, DbError>> => {return await db.activate(an)},
  deactivate: async (an: string): Promise<Result<void, DbError>> => {return await db.deactivate(an)},
  deactivateAll: async (): Promise<Result<void, DbError>> => {return await db.deactivateAll()},
  close: async (): Promise<Result<void, DbError>> => {return await db.close()},
  adminDeleteLock: async (fp: string): Promise<Result<void, DbError>> => {return await db.adminDeleteLock(fp)},
  adminDeleteAgent: async (an: string): Promise<Result<void, DbError>> => {return await db.adminDeleteAgent(an)},
  adminResetKey: async (an: string): Promise<Result<AgentRegistration, DbError>> => {return await db.adminResetKey(an)},
  adminSendMessage: async (from: string, to: string, content: string): Promise<Result<string, DbError>> =>
    {return await db.adminSendMessage(from, to, encrypt(content, currentKey))},
  adminReset: async (): Promise<Result<void, DbError>> => {return await db.adminReset()},
}};
