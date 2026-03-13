/// Encryption middleware for TooManyCooksDb.
///
/// Wraps a TooManyCooksDb instance, encrypting content fields on the way out
/// and decrypting them on the way in. Agent names/IDs stay plaintext.
///
/// Encrypted fields: lock.reason, message.content, plan.goal, plan.currentTask

import type {
  AgentPlan,
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
const ERR_DECRYPTION_FAILED = "DECRYPTION_FAILED";

/** Encrypt a nullable/optional string field. */
const encryptField = (
  value: string | null | undefined,
  wk: WorkspaceKey,
): string | null | undefined =>
  {return value === null || value === undefined ? value : encrypt(value, wk)};

/** Decrypt a nullable string field, returning Result. */
const decryptField = (
  value: string | null,
  keychain: Keychain,
): Result<string | null, string> => {
  if (value === null) {return success(null);}
  return decrypt(value, keychain);
};

/** Decrypt a string field (non-nullable), returning Result. */
const decryptRequired = (
  value: string,
  keychain: Keychain,
): Result<string, string> => {return decrypt(value, keychain)};

/** Decrypt a FileLock's reason field. */
const decryptLock = (
  lock: FileLock,
  keychain: Keychain,
): Result<FileLock, string> => {
  const reasonResult = decryptField(lock.reason, keychain);
  return reasonResult.ok
    ? success({ ...lock, reason: reasonResult.value })
    : error(reasonResult.error);
};

/** Decrypt a LockResult's nested lock reason. */
const decryptLockResult = (
  lr: LockResult,
  keychain: Keychain,
): Result<LockResult, string> => {
  if (lr.lock === undefined) {return success(lr);}
  const lockResult = decryptLock(lr.lock, keychain);
  return lockResult.ok
    ? success({ ...lr, lock: lockResult.value })
    : error(lockResult.error);
};

/** Decrypt a Message's content field. */
const decryptMessage = (
  msg: Message,
  keychain: Keychain,
): Result<Message, string> => {
  const contentResult = decryptRequired(msg.content, keychain);
  return contentResult.ok
    ? success({ ...msg, content: contentResult.value })
    : error(contentResult.error);
};

/** Decrypt an AgentPlan's goal and currentTask fields. */
const decryptPlan = (
  plan: AgentPlan,
  keychain: Keychain,
): Result<AgentPlan, string> => {
  const goalResult = decryptRequired(plan.goal, keychain);
  if (!goalResult.ok) {return error(goalResult.error);}
  const taskResult = decryptRequired(plan.currentTask, keychain);
  return taskResult.ok
    ? success({
      ...plan,
      goal: goalResult.value,
      currentTask: taskResult.value,
    })
    : error(taskResult.error);
};

/** Decrypt all items in a readonly array using a mapper. */
const decryptArray = <T>(
  items: readonly T[],
  keychain: Keychain,
  mapper: (item: T, kc: Keychain) => Result<T, string>,
): Result<readonly T[], string> => {
  const results: T[] = [];
  for (const item of items) {
    const mapped = mapper(item, keychain);
    if (!mapped.ok) {return error(mapped.error);}
    results.push(mapped.value);
  }
  return success(results);
};

/** Convert a crypto error to a DbError result. */
const toDbError = <T>(
  result: Result<T, string>,
): Result<T, DbError> =>
  {return result.ok
    ? success(result.value)
    : error({ code: ERR_DECRYPTION_FAILED, message: result.error })};

/** Wrap a db Result through a decryption transform. */
const mapDbResult = async <T>(
  dbResult: Promise<Result<T, DbError>>,
  transform: (value: T, kc: Keychain) => Result<T, string>,
  keychain: Keychain,
): Promise<Result<T, DbError>> => {
  const result = await dbResult;
  if (!result.ok) {return result;}
  return toDbError(transform(result.value, keychain));
};

/** Create an encrypting wrapper around a TooManyCooksDb. */
// eslint-disable-next-line max-lines-per-function -- single object literal implementing full TooManyCooksDb interface
export const withEncryption = (
  db: TooManyCooksDb,
  currentKey: WorkspaceKey,
  keychain: Keychain,
): TooManyCooksDb => {return {
  register: async (agentName) => {return await db.register(agentName)},
  authenticate: async (name, key) => {return await db.authenticate(name, key)},
  lookupByKey: async (key) => {return await db.lookupByKey(key)},
  listAgents: async () => {return await db.listAgents()},
  acquireLock: async (fp, an, ak, reason, timeout) =>
    {return await mapDbResult(
      db.acquireLock(fp, an, ak, encryptField(reason, currentKey), timeout),
      decryptLockResult,
      keychain,
    )},
  releaseLock: async (fp, an, ak) => {return await db.releaseLock(fp, an, ak)},
  forceReleaseLock: async (fp, an, ak) => {return await db.forceReleaseLock(fp, an, ak)},
  queryLock: async (fp): Promise<Result<FileLock | null, DbError>> => {
    const result = await db.queryLock(fp);
    if (!result.ok || result.value === null) {return result;}
    return toDbError(decryptLock(result.value, keychain));
  },
  listLocks: async () =>
    {return await mapDbResult(
      db.listLocks(),
      (locks, kc) => {return decryptArray(locks, kc, decryptLock)},
      keychain,
    )},
  renewLock: async (fp, an, ak, timeoutMs) => {return await db.renewLock(fp, an, ak, timeoutMs)},
  sendMessage: async (from, key, to, content) =>
    {return await db.sendMessage(from, key, to, encrypt(content, currentKey))},
  getMessages: async (an, ak, opts) =>
    {return await mapDbResult(
      db.getMessages(an, ak, opts),
      (msgs, kc) => {return decryptArray(msgs, kc, decryptMessage)},
      keychain,
    )},
  markRead: async (id, an, ak) => {return await db.markRead(id, an, ak)},
  updatePlan: async (an, ak, goal, task) =>
    {return await db.updatePlan(
      an,
      ak,
      encrypt(goal, currentKey),
      encrypt(task, currentKey),
    )},
  getPlan: async (an): Promise<Result<AgentPlan | null, DbError>> => {
    const result = await db.getPlan(an);
    if (!result.ok || result.value === null) {return result;}
    return toDbError(decryptPlan(result.value, keychain));
  },
  listPlans: async () =>
    {return await mapDbResult(
      db.listPlans(),
      (plans, kc) => {return decryptArray(plans, kc, decryptPlan)},
      keychain,
    )},
  listAllMessages: async () =>
    {return await mapDbResult(
      db.listAllMessages(),
      (msgs, kc) => {return decryptArray(msgs, kc, decryptMessage)},
      keychain,
    )},
  activate: async (an) => {return await db.activate(an)},
  deactivate: async (an) => {return await db.deactivate(an)},
  deactivateAll: async () => {return await db.deactivateAll()},
  close: async () => {return await db.close()},
  adminDeleteLock: async (fp) => {return await db.adminDeleteLock(fp)},
  adminDeleteAgent: async (an) => {return await db.adminDeleteAgent(an)},
  adminResetKey: async (an) => {return await db.adminResetKey(an)},
  adminSendMessage: async (from, to, content) =>
    {return await db.adminSendMessage(from, to, encrypt(content, currentKey))},
  adminReset: async () => {return await db.adminReset()},
}};
