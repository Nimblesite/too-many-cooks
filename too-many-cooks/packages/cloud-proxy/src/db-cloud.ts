/// Cloud TooManyCooksDb implementation.
///
/// Makes HTTPS calls to the TMC Cloud Edge Function instead of SQLite queries.
/// Each method maps 1:1 to a POST endpoint on the Edge Function.

import type {
  DbError,
  Result,
  TooManyCooksDb,
} from "@too-many-cooks/core";
import {
  agentIdentityFromJson,
  agentPlanFromJson,
  agentRegistrationFromJson,
  fileLockFromJson,
  lockResultFromJson,
  messageFromJson,
} from "@too-many-cooks/core";

/** Content-Type header value for JSON requests. */
const CONTENT_TYPE_JSON = "application/json";

/** Authorization header prefix. */
const AUTH_BEARER_PREFIX = "Bearer ";

/** Custom header for workspace ID. */
const WORKSPACE_ID_HEADER = "X-Workspace-Id";

/** HTTP method for all API calls. */
const HTTP_METHOD = "POST";

/** Error code for network/HTTP failures. */
const ERR_NETWORK = "NETWORK_ERROR";

/** Default error message when API returns no details. */
const ERR_UNKNOWN_API = "Unknown API error";

/** Content-Type header key. */
const CONTENT_TYPE_HEADER = "Content-Type";

/** Authorization header key. */
const AUTHORIZATION_HEADER = "Authorization";

/** API endpoint names. Mirror TooManyCooksDb interface methods. */
const EP_REGISTER = "register";
const EP_AUTHENTICATE = "authenticate";
const EP_LOOKUP_BY_KEY = "lookupByKey";
const EP_LIST_AGENTS = "listAgents";
const EP_ACQUIRE_LOCK = "acquireLock";
const EP_RELEASE_LOCK = "releaseLock";
const EP_FORCE_RELEASE_LOCK = "forceReleaseLock";
const EP_QUERY_LOCK = "queryLock";
const EP_LIST_LOCKS = "listLocks";
const EP_RENEW_LOCK = "renewLock";
const EP_SEND_MESSAGE = "sendMessage";
const EP_GET_MESSAGES = "getMessages";
const EP_MARK_READ = "markRead";
const EP_UPDATE_PLAN = "updatePlan";
const EP_GET_PLAN = "getPlan";
const EP_LIST_PLANS = "listPlans";
const EP_LIST_ALL_MESSAGES = "listAllMessages";
const EP_ACTIVATE = "activate";
const EP_DEACTIVATE = "deactivate";
const EP_DEACTIVATE_ALL = "deactivateAll";
const EP_CLOSE = "close";
const EP_ADMIN_DELETE_LOCK = "adminDeleteLock";
const EP_ADMIN_DELETE_AGENT = "adminDeleteAgent";
const EP_ADMIN_RESET_KEY = "adminResetKey";
const EP_ADMIN_SEND_MESSAGE = "adminSendMessage";
const EP_ADMIN_RESET = "adminReset";

/** Type guard: value is a plain object (Record). */
const isRecord = (val: unknown): val is Record<string, unknown> =>
  {return typeof val === "object" && val !== null && !Array.isArray(val)};

/** API response shape matching Result<T, DbError>. */
type ApiResponse = {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
};

/** Type guard: validates an unknown JSON payload is an ApiResponse. */
const isApiResponse = (val: unknown): val is ApiResponse =>
  {return isRecord(val) && typeof val.ok === "boolean"};

/** Extract a DbError from an API error response. */
const extractDbError = (body: ApiResponse): DbError => {return {
  code: body.error?.code ?? ERR_NETWORK,
  message: body.error?.message ?? ERR_UNKNOWN_API,
}};

/** Value extractor: ignores payload, returns void. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- callback signature requires parameter
const extractVoid = (_val: unknown): undefined => {return undefined};

/** Value extractor: narrows to string via type guard. */
const extractString = (val: unknown): string =>
  {return typeof val === "string" ? val : ""};

/** Create a value extractor that applies a mapper to a Record. */
const mapped = <T>(
  mapper: (raw: Record<string, unknown>) => T,
): (val: unknown) => T =>
  {return (val) => {return mapper(isRecord(val) ? val : {})}};

/** Create a value extractor that maps an array of Records. */
const mappedArray = <T>(
  mapper: (raw: Record<string, unknown>) => T,
): (val: unknown) => readonly T[] =>
  {return (val) =>
    {return Array.isArray(val)
      ? val.map((item: unknown) => {return mapper(isRecord(item) ? item : {})})
      : []}};

/** Create a value extractor for nullable single-item responses. */
const mappedNullable = <T>(
  mapper: (raw: Record<string, unknown>) => T,
): (val: unknown) => T | null =>
  {return (val) =>
    {return val === null || val === undefined ? null : mapper(isRecord(val) ? val : {})}};

/** Generic API response parser. Replaces 5 specialized parse functions. */
const parseApiResponse = <T>(
  body: ApiResponse,
  extract: (value: unknown) => T,
): Result<T, DbError> =>
  {return body.ok
    ? { ok: true, value: extract(body.value) }
    : { ok: false, error: extractDbError(body) }};

/** Create a cloud-backed TooManyCooksDb that calls the Edge Function. */
// eslint-disable-next-line max-lines-per-function -- single object literal implementing full TooManyCooksDb interface
export const createCloudDb = (
  apiUrl: string,
  apiKey: string,
  workspaceId: string,
): TooManyCooksDb => {
  const call = async (
    method: string,
    args: Record<string, unknown>,
  ): Promise<ApiResponse> => {
    const response = await fetch(`${apiUrl}/${method}`, {
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

  return {
    register: async (agentName) =>
      {return parseApiResponse(
        await call(EP_REGISTER, { agentName }),
        mapped(agentRegistrationFromJson),
      )},
    authenticate: async (agentName, agentKey) =>
      {return parseApiResponse(
        await call(EP_AUTHENTICATE, { agentName, agentKey }),
        mapped(agentIdentityFromJson),
      )},
    lookupByKey: async (agentKey) =>
      {return parseApiResponse(
        await call(EP_LOOKUP_BY_KEY, { agentKey }),
        extractString,
      )},
    listAgents: async () =>
      {return parseApiResponse(
        await call(EP_LIST_AGENTS, {}),
        mappedArray(agentIdentityFromJson),
      )},
    acquireLock: async (filePath, agentName, agentKey, reason, timeoutMs) =>
      {return parseApiResponse(
        await call(EP_ACQUIRE_LOCK, {
          filePath, agentName, agentKey, reason, timeoutMs,
        }),
        mapped(lockResultFromJson),
      )},
    releaseLock: async (filePath, agentName, agentKey) =>
      {return parseApiResponse(
        await call(EP_RELEASE_LOCK, { filePath, agentName, agentKey }),
        extractVoid,
      )},
    forceReleaseLock: async (filePath, agentName, agentKey) =>
      {return parseApiResponse(
        await call(EP_FORCE_RELEASE_LOCK, { filePath, agentName, agentKey }),
        extractVoid,
      )},
    queryLock: async (filePath) =>
      {return parseApiResponse(
        await call(EP_QUERY_LOCK, { filePath }),
        mappedNullable(fileLockFromJson),
      )},
    listLocks: async () =>
      {return parseApiResponse(
        await call(EP_LIST_LOCKS, {}),
        mappedArray(fileLockFromJson),
      )},
    renewLock: async (filePath, agentName, agentKey, timeoutMs) =>
      {return parseApiResponse(
        await call(EP_RENEW_LOCK, {
          filePath, agentName, agentKey, timeoutMs,
        }),
        extractVoid,
      )},
    sendMessage: async (fromAgent, fromKey, toAgent, content) =>
      {return parseApiResponse(
        await call(EP_SEND_MESSAGE, {
          fromAgent, fromKey, toAgent, content,
        }),
        extractString,
      )},
    getMessages: async (agentName, agentKey, options) =>
      {return parseApiResponse(
        await call(EP_GET_MESSAGES, {
          agentName, agentKey, unreadOnly: options?.unreadOnly,
        }),
        mappedArray(messageFromJson),
      )},
    markRead: async (messageId, agentName, agentKey) =>
      {return parseApiResponse(
        await call(EP_MARK_READ, { messageId, agentName, agentKey }),
        extractVoid,
      )},
    updatePlan: async (agentName, agentKey, goal, currentTask) =>
      {return parseApiResponse(
        await call(EP_UPDATE_PLAN, {
          agentName, agentKey, goal, currentTask,
        }),
        extractVoid,
      )},
    getPlan: async (agentName) =>
      {return parseApiResponse(
        await call(EP_GET_PLAN, { agentName }),
        mappedNullable(agentPlanFromJson),
      )},
    listPlans: async () =>
      {return parseApiResponse(
        await call(EP_LIST_PLANS, {}),
        mappedArray(agentPlanFromJson),
      )},
    listAllMessages: async () =>
      {return parseApiResponse(
        await call(EP_LIST_ALL_MESSAGES, {}),
        mappedArray(messageFromJson),
      )},
    activate: async (agentName) =>
      {return parseApiResponse(
        await call(EP_ACTIVATE, { agentName }),
        extractVoid,
      )},
    deactivate: async (agentName) =>
      {return parseApiResponse(
        await call(EP_DEACTIVATE, { agentName }),
        extractVoid,
      )},
    deactivateAll: async () =>
      {return parseApiResponse(await call(EP_DEACTIVATE_ALL, {}), extractVoid)},
    close: async () =>
      {return parseApiResponse(await call(EP_CLOSE, {}), extractVoid)},
    adminDeleteLock: async (filePath) =>
      {return parseApiResponse(
        await call(EP_ADMIN_DELETE_LOCK, { filePath }),
        extractVoid,
      )},
    adminDeleteAgent: async (agentName) =>
      {return parseApiResponse(
        await call(EP_ADMIN_DELETE_AGENT, { agentName }),
        extractVoid,
      )},
    adminResetKey: async (agentName) =>
      {return parseApiResponse(
        await call(EP_ADMIN_RESET_KEY, { agentName }),
        mapped(agentRegistrationFromJson),
      )},
    adminSendMessage: async (fromAgent, toAgent, content) =>
      {return parseApiResponse(
        await call(EP_ADMIN_SEND_MESSAGE, { fromAgent, toAgent, content }),
        extractString,
      )},
    adminReset: async () =>
      {return parseApiResponse(await call(EP_ADMIN_RESET, {}), extractVoid)},
  };
};
