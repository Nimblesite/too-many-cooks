/// Cloud TooManyCooksDb implementation.
///
/// Makes HTTPS calls to the TMC Cloud Edge Function instead of SQLite queries.
/// Each method maps 1:1 to a POST endpoint on the Edge Function.

import type {
  DbError,
  Result,
  TooManyCooksDb,
  AgentRegistration,
  AgentIdentity,
  LockResult,
  FileLock,
  Message,
  AgentPlan,
} from "too-many-cooks-core";
import {
  agentIdentityFromJson,
  agentPlanFromJson,
  agentRegistrationFromJson,
  fileLockFromJson,
  lockResultFromJson,
  messageFromJson,
} from "too-many-cooks-core";

/** Content-Type header value for JSON requests. */
const CONTENT_TYPE_JSON: string = "application/json";

/** Authorization header prefix. */
const AUTH_BEARER_PREFIX: string = "Bearer ";

/** Custom header for workspace ID. */
const WORKSPACE_ID_HEADER: string = "X-Workspace-Id";

/** HTTP method for all API calls. */
const HTTP_METHOD: string = "POST";

/** Error code for network/HTTP failures. */
const ERR_NETWORK: string = "NETWORK_ERROR";

/** Default error message when API returns no details. */
const ERR_UNKNOWN_API: string = "Unknown API error";

/** Content-Type header key. */
const CONTENT_TYPE_HEADER: string = "Content-Type";

/** Authorization header key. */
const AUTHORIZATION_HEADER: string = "Authorization";

/** API endpoint names. Mirror TooManyCooksDb interface methods. */
const EP_REGISTER: string = "register";
const EP_AUTHENTICATE: string = "authenticate";
const EP_LOOKUP_BY_KEY: string = "lookupByKey";
const EP_LIST_AGENTS: string = "listAgents";
const EP_ACQUIRE_LOCK: string = "acquireLock";
const EP_RELEASE_LOCK: string = "releaseLock";
const EP_FORCE_RELEASE_LOCK: string = "forceReleaseLock";
const EP_QUERY_LOCK: string = "queryLock";
const EP_LIST_LOCKS: string = "listLocks";
const EP_RENEW_LOCK: string = "renewLock";
const EP_SEND_MESSAGE: string = "sendMessage";
const EP_GET_MESSAGES: string = "getMessages";
const EP_MARK_READ: string = "markRead";
const EP_UPDATE_PLAN: string = "updatePlan";
const EP_GET_PLAN: string = "getPlan";
const EP_LIST_PLANS: string = "listPlans";
const EP_LIST_ALL_MESSAGES: string = "listAllMessages";
const EP_ACTIVATE: string = "activate";
const EP_DEACTIVATE: string = "deactivate";
const EP_DEACTIVATE_ALL: string = "deactivateAll";
const EP_CLOSE: string = "close";
const EP_ADMIN_DELETE_LOCK: string = "adminDeleteLock";
const EP_ADMIN_DELETE_AGENT: string = "adminDeleteAgent";
const EP_ADMIN_RESET_KEY: string = "adminResetKey";
const EP_ADMIN_SEND_MESSAGE: string = "adminSendMessage";
const EP_ADMIN_RESET: string = "adminReset";

/** Type guard: value is a plain object (Record). */
const isRecord: (val: unknown) => val is Record<string, unknown> = (
  val: unknown,
): val is Record<string, unknown> =>
  typeof val === "object" && val !== null && !Array.isArray(val);

/** API response shape matching Result<T, DbError>. */
type ApiResponse = {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
};

/** Type guard: validates an unknown JSON payload is an ApiResponse. */
const isApiResponse: (val: unknown) => val is ApiResponse = (
  val: unknown,
): val is ApiResponse => isRecord(val) && typeof val.ok === "boolean";

/** Extract a DbError from an API error response. */
const extractDbError: (body: ApiResponse) => DbError = (
  body: ApiResponse,
): DbError => ({
  code: body.error?.code ?? ERR_NETWORK,
  message: body.error?.message ?? ERR_UNKNOWN_API,
});

/** Value extractor: ignores payload, returns void. */
const extractVoid: (_val: unknown) => undefined = (): undefined => undefined;

/** Value extractor: narrows to string via type guard. */
const extractString: (val: unknown) => string = (val: unknown): string =>
  typeof val === "string" ? val : "";

/** Create a value extractor that applies a mapper to a Record. */
const mapped: <T>(
  mapper: (raw: Record<string, unknown>) => T,
) => (val: unknown) => T = <T>(
  mapper: (raw: Record<string, unknown>) => T,
): ((val: unknown) => T) =>
  (val: unknown): T =>
    mapper(isRecord(val) ? val : {});

/** Create a value extractor that maps an array of Records. */
const mappedArray: <T>(
  mapper: (raw: Record<string, unknown>) => T,
) => (val: unknown) => readonly T[] = <T>(
  mapper: (raw: Record<string, unknown>) => T,
): ((val: unknown) => readonly T[]) =>
  (val: unknown): readonly T[] =>
    Array.isArray(val)
      ? val.map((item: unknown): T => mapper(isRecord(item) ? item : {}))
      : [];

/** Create a value extractor for nullable single-item responses. */
const mappedNullable: <T>(
  mapper: (raw: Record<string, unknown>) => T,
) => (val: unknown) => T | null = <T>(
  mapper: (raw: Record<string, unknown>) => T,
): ((val: unknown) => T | null) =>
  (val: unknown): T | null =>
    val === null || val === undefined ? null : mapper(isRecord(val) ? val : {});

/** Generic API response parser. Replaces 5 specialized parse functions. */
const parseApiResponse: <T>(
  body: ApiResponse,
  extract: (value: unknown) => T,
) => Result<T, DbError> = <T>(
  body: ApiResponse,
  extract: (value: unknown) => T,
): Result<T, DbError> =>
  body.ok
    ? { ok: true, value: extract(body.value) }
    : { ok: false, error: extractDbError(body) };

/** API caller type. */
type ApiCaller = (method: string, args: Record<string, unknown>) => Promise<ApiResponse>;

/** Create an HTTP API caller bound to a specific endpoint. */
const createApiCaller: (
  apiUrl: string,
  apiKey: string,
  workspaceId: string,
) => ApiCaller = (
  apiUrl: string,
  apiKey: string,
  workspaceId: string,
): ApiCaller =>
  async (method: string, args: Record<string, unknown>): Promise<ApiResponse> => {
    const response: Response = await fetch(`${apiUrl}/${method}`, {
      method: HTTP_METHOD,
      headers: {
        [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON,
        [AUTHORIZATION_HEADER]: `${AUTH_BEARER_PREFIX}${apiKey}`,
        [WORKSPACE_ID_HEADER]: workspaceId,
      },
      body: JSON.stringify(args),
    });
    const json: unknown = await response.json();
    return isApiResponse(json)
      ? json
      : { ok: false, error: { code: ERR_NETWORK, message: ERR_UNKNOWN_API } };
  };

/** Build the identity/auth methods for TooManyCooksDb. */
const buildIdentityMethods: (call: ApiCaller) => Pick<TooManyCooksDb,
  "activate" | "authenticate" | "close" | "deactivate" | "deactivateAll" | "listAgents" | "lookupByKey" | "register"
> = (call: ApiCaller): Pick<TooManyCooksDb,
  "activate" | "authenticate" | "close" | "deactivate" | "deactivateAll" | "listAgents" | "lookupByKey" | "register"
> => ({
  register: async (agentName: string): Promise<Result<AgentRegistration, DbError>> =>
    parseApiResponse(await call(EP_REGISTER, { agentName }), mapped(agentRegistrationFromJson)),
  authenticate: async (agentName: string, agentKey: string): Promise<Result<AgentIdentity, DbError>> =>
    parseApiResponse(await call(EP_AUTHENTICATE, { agentName, agentKey }), mapped(agentIdentityFromJson)),
  lookupByKey: async (agentKey: string): Promise<Result<string, DbError>> =>
    parseApiResponse(await call(EP_LOOKUP_BY_KEY, { agentKey }), extractString),
  listAgents: async (): Promise<Result<readonly AgentIdentity[], DbError>> =>
    parseApiResponse(await call(EP_LIST_AGENTS, {}), mappedArray(agentIdentityFromJson)),
  activate: async (agentName: string): Promise<Result<void, DbError>> =>
    parseApiResponse(await call(EP_ACTIVATE, { agentName }), extractVoid),
  deactivate: async (agentName: string): Promise<Result<void, DbError>> =>
    parseApiResponse(await call(EP_DEACTIVATE, { agentName }), extractVoid),
  deactivateAll: async (): Promise<Result<void, DbError>> =>
    parseApiResponse(await call(EP_DEACTIVATE_ALL, {}), extractVoid),
  close: async (): Promise<Result<void, DbError>> =>
    parseApiResponse(await call(EP_CLOSE, {}), extractVoid),
});

/** Build the lock methods for TooManyCooksDb. */
const buildLockMethods: (call: ApiCaller) => Pick<TooManyCooksDb,
  "acquireLock" | "forceReleaseLock" | "listLocks" | "queryLock" | "releaseLock" | "renewLock"
> = (call: ApiCaller): Pick<TooManyCooksDb,
  "acquireLock" | "forceReleaseLock" | "listLocks" | "queryLock" | "releaseLock" | "renewLock"
> => ({
  acquireLock: async (
    filePath: string, agentName: string, agentKey: string,
    reason: string | null | undefined, timeoutMs: number,
  ): Promise<Result<LockResult, DbError>> =>
    parseApiResponse(
      await call(EP_ACQUIRE_LOCK, { filePath, agentName, agentKey, reason, timeoutMs }),
      mapped(lockResultFromJson),
    ),
  releaseLock: async (fp: string, an: string, ak: string): Promise<Result<void, DbError>> =>
    parseApiResponse(await call(EP_RELEASE_LOCK, { filePath: fp, agentName: an, agentKey: ak }), extractVoid),
  forceReleaseLock: async (fp: string, an: string, ak: string): Promise<Result<void, DbError>> =>
    parseApiResponse(await call(EP_FORCE_RELEASE_LOCK, { filePath: fp, agentName: an, agentKey: ak }), extractVoid),
  queryLock: async (filePath: string): Promise<Result<FileLock | null, DbError>> =>
    parseApiResponse(await call(EP_QUERY_LOCK, { filePath }), mappedNullable(fileLockFromJson)),
  listLocks: async (): Promise<Result<readonly FileLock[], DbError>> =>
    parseApiResponse(await call(EP_LIST_LOCKS, {}), mappedArray(fileLockFromJson)),
  renewLock: async (fp: string, an: string, ak: string, timeoutMs: number): Promise<Result<void, DbError>> =>
    parseApiResponse(
      await call(EP_RENEW_LOCK, { filePath: fp, agentName: an, agentKey: ak, timeoutMs }),
      extractVoid,
    ),
});

/** Build the message methods for TooManyCooksDb. */
const buildMessageMethods: (call: ApiCaller) => Pick<TooManyCooksDb,
  "getMessages" | "listAllMessages" | "markRead" | "sendMessage"
> = (call: ApiCaller): Pick<TooManyCooksDb,
  "getMessages" | "listAllMessages" | "markRead" | "sendMessage"
> => ({
  sendMessage: async (fromAgent: string, fromKey: string, toAgent: string, content: string): Promise<Result<string, DbError>> =>
    parseApiResponse(await call(EP_SEND_MESSAGE, { fromAgent, fromKey, toAgent, content }), extractString),
  getMessages: async (
    agentName: string, agentKey: string, options?: { readonly unreadOnly?: boolean },
  ): Promise<Result<readonly Message[], DbError>> =>
    parseApiResponse(
      await call(EP_GET_MESSAGES, { agentName, agentKey, unreadOnly: options?.unreadOnly }),
      mappedArray(messageFromJson),
    ),
  markRead: async (messageId: string, agentName: string, agentKey: string): Promise<Result<void, DbError>> =>
    parseApiResponse(await call(EP_MARK_READ, { messageId, agentName, agentKey }), extractVoid),
  listAllMessages: async (): Promise<Result<readonly Message[], DbError>> =>
    parseApiResponse(await call(EP_LIST_ALL_MESSAGES, {}), mappedArray(messageFromJson)),
});

/** Build the plan methods for TooManyCooksDb. */
const buildPlanMethods: (call: ApiCaller) => Pick<TooManyCooksDb,
  "getPlan" | "listPlans" | "updatePlan"
> = (call: ApiCaller): Pick<TooManyCooksDb,
  "getPlan" | "listPlans" | "updatePlan"
> => ({
  updatePlan: async (agentName: string, agentKey: string, goal: string, currentTask: string): Promise<Result<void, DbError>> =>
    parseApiResponse(await call(EP_UPDATE_PLAN, { agentName, agentKey, goal, currentTask }), extractVoid),
  getPlan: async (agentName: string): Promise<Result<AgentPlan | null, DbError>> =>
    parseApiResponse(await call(EP_GET_PLAN, { agentName }), mappedNullable(agentPlanFromJson)),
  listPlans: async (): Promise<Result<readonly AgentPlan[], DbError>> =>
    parseApiResponse(await call(EP_LIST_PLANS, {}), mappedArray(agentPlanFromJson)),
});

/** Build the admin methods for TooManyCooksDb. */
const buildAdminMethods: (call: ApiCaller) => Pick<TooManyCooksDb,
  "adminDeleteAgent" | "adminDeleteLock" | "adminReset" | "adminResetKey" | "adminSendMessage"
> = (call: ApiCaller): Pick<TooManyCooksDb,
  "adminDeleteAgent" | "adminDeleteLock" | "adminReset" | "adminResetKey" | "adminSendMessage"
> => ({
  adminDeleteLock: async (filePath: string): Promise<Result<void, DbError>> =>
    parseApiResponse(await call(EP_ADMIN_DELETE_LOCK, { filePath }), extractVoid),
  adminDeleteAgent: async (agentName: string): Promise<Result<void, DbError>> =>
    parseApiResponse(await call(EP_ADMIN_DELETE_AGENT, { agentName }), extractVoid),
  adminResetKey: async (agentName: string): Promise<Result<AgentRegistration, DbError>> =>
    parseApiResponse(await call(EP_ADMIN_RESET_KEY, { agentName }), mapped(agentRegistrationFromJson)),
  adminSendMessage: async (fromAgent: string, toAgent: string, content: string): Promise<Result<string, DbError>> =>
    parseApiResponse(await call(EP_ADMIN_SEND_MESSAGE, { fromAgent, toAgent, content }), extractString),
  adminReset: async (): Promise<Result<void, DbError>> =>
    parseApiResponse(await call(EP_ADMIN_RESET, {}), extractVoid),
});

/** Create a cloud-backed TooManyCooksDb that calls the Edge Function. */
export const createCloudDb: (
  apiUrl: string,
  apiKey: string,
  workspaceId: string,
) => TooManyCooksDb = (
  apiUrl: string,
  apiKey: string,
  workspaceId: string,
): TooManyCooksDb => {
  const call: ApiCaller = createApiCaller(apiUrl, apiKey, workspaceId);
  return {
    ...buildIdentityMethods(call),
    ...buildLockMethods(call),
    ...buildMessageMethods(call),
    ...buildPlanMethods(call),
    ...buildAdminMethods(call),
  };
};
