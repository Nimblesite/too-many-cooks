/// Shared utilities for tool handlers.

import type { TooManyCooksDb } from "../db-interface.js";
import type { Result } from "../result.js";
import { type DbError, dbErrorToJson } from "../types.js";
import {
  type CallToolResult,
  type SessionGetter,
  textContent,
} from "../mcp-types.js";

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

type IdentityOk = {
  readonly isError: false;
  readonly agentName: string;
  readonly agentKey: string;
};
type IdentityErr = {
  readonly isError: true;
  readonly result: CallToolResult;
};

export type IdentityResult = IdentityErr | IdentityOk;

export const resolveIdentity: (
  db: TooManyCooksDb,
  args: Record<string, unknown>,
  getSession: SessionGetter,
) => Promise<IdentityResult> = async (
  db: TooManyCooksDb,
  args: Record<string, unknown>,
  getSession: SessionGetter,
): Promise<IdentityResult> => {
  const keyOverride: string | null =
    typeof args.agent_key === "string" ? args.agent_key : null;
  if (keyOverride !== null) {
    const lookupResult: Awaited<ReturnType<TooManyCooksDb["lookupByKey"]>> = await db.lookupByKey(keyOverride);
    if (!lookupResult.ok) {
      return { isError: true, result: makeErrorResult(lookupResult.error) };
    }
    return {
      isError: false,
      agentName: lookupResult.value,
      agentKey: keyOverride,
    };
  }
  const session: ReturnType<SessionGetter> = getSession();
  if (session === null) {
    return {
      isError: true,
      result: errorContent("not_registered: call register first"),
    };
  }
  return {
    isError: false,
    agentName: session.agentName,
    agentKey: session.agentKey,
  };
};

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

export const makeErrorResult: (e: DbError) => CallToolResult = (e: DbError): CallToolResult => {return {
  content: [textContent(JSON.stringify(dbErrorToJson(e)))],
  isError: true,
}};

export const errorContent: (msg: string) => CallToolResult = (msg: string): CallToolResult => {return {
  content: [textContent(JSON.stringify({ error: msg }))],
  isError: true,
}};

/** Build a successful JSON tool result. */
export const jsonResult: (payload: Record<string, unknown>) => CallToolResult = (payload: Record<string, unknown>): CallToolResult => {return {
  content: [textContent(JSON.stringify(payload))],
  isError: false,
}};

/** Build a successful JSON tool result from a db list result. */
export const listJsonResult: <T>(
  result: Result<readonly T[], DbError>,
  key: string,
  toJson: (item: T) => Record<string, unknown>,
) => CallToolResult = <T>(
  result: Result<readonly T[], DbError>,
  key: string,
  toJson: (item: T) => Record<string, unknown>,
): CallToolResult => {
  if (!result.ok) {return makeErrorResult(result.error);}
  return jsonResult({ [key]: result.value.map(toJson) });
};

/** Error message when a tool call omits its `action` argument. */
export const MISSING_ACTION_MESSAGE: string = "missing_parameter: action is required";

/** Extract the `action` string argument, or an error result when missing. */
export const requireActionArg: (args: Record<string, unknown>) => string | CallToolResult = (
  args: Record<string, unknown>,
): string | CallToolResult => {
  const actionArg: unknown = args.action;
  return typeof actionArg === "string" ? actionArg : errorContent(MISSING_ACTION_MESSAGE);
};

/** Build an error result for an unrecognized action. */
export const unknownActionError: (action: string) => CallToolResult = (action: string): CallToolResult =>
  errorContent(`Unknown action: ${action}`);

/** Resolve a caller identity and pass it to `fn`, or short-circuit with an error result. */
export const withResolvedAgent: <T>(
  db: TooManyCooksDb,
  args: Record<string, unknown>,
  getSession: SessionGetter,
  fn: (agentName: string, agentKey: string) => Promise<T>,
) => Promise<T | CallToolResult> = async <T>(
  db: TooManyCooksDb,
  args: Record<string, unknown>,
  getSession: SessionGetter,
  fn: (agentName: string, agentKey: string) => Promise<T>,
): Promise<T | CallToolResult> => {
  const identity: IdentityResult = await resolveIdentity(db, args, getSession);
  if (identity.isError) {return identity.result;}
  return await fn(identity.agentName, identity.agentKey);
};
