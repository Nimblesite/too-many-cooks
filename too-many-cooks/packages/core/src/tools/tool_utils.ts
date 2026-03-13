/// Shared utilities for tool handlers.

import type { TooManyCooksDb } from "../db-interface.js";
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
