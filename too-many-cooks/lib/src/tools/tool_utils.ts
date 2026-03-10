/// Shared utilities for tool handlers.

import {
  type TooManyCooksDb,
  type DbError,
  dbErrorToJson,
} from "../data/data.js";
import {
  textContent,
  type SessionGetter,
  type CallToolResult,
} from "../types.js";

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

export type IdentityResult = IdentityOk | IdentityErr;

export const resolveIdentity = (
  db: TooManyCooksDb,
  args: Record<string, unknown>,
  getSession: SessionGetter,
): IdentityResult => {
  const keyOverride =
    typeof args.agent_key === "string" ? args.agent_key : null;
  if (keyOverride !== null) {
    const lookupResult = db.lookupByKey(keyOverride);
    if (!lookupResult.ok) {
      return { isError: true, result: makeErrorResult(lookupResult.error) };
    }
    return {
      isError: false,
      agentName: lookupResult.value,
      agentKey: keyOverride,
    };
  }
  const session = getSession();
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

export const makeErrorResult = (e: DbError): CallToolResult => ({
  content: [textContent(JSON.stringify(dbErrorToJson(e)))],
  isError: true,
});

export const errorContent = (msg: string): CallToolResult => ({
  content: [textContent(JSON.stringify({ error: msg }))],
  isError: true,
});
