/// Shared utilities for tool handlers.

import { z } from "zod";

import type { TooManyCooksDb } from "../db-interface.js";
import type { Logger } from "../logger.js";
import type { Result } from "../result.js";
import { success } from "../result.js";
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

export const resolveIdentity = async (
  db: TooManyCooksDb,
  args: Record<string, unknown>,
  getSession: SessionGetter
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

export const makeErrorResult = (e: DbError): CallToolResult => {return {
  content: [textContent(JSON.stringify(dbErrorToJson(e)))],
  isError: true,
}};

export const errorContent = (msg: string): CallToolResult => {return {
  content: [textContent(JSON.stringify({ error: msg }))],
  isError: true,
}};

/** Build a successful JSON tool result. */
export const jsonResult = (payload: Record<string, unknown>): CallToolResult => {return {
  content: [textContent(JSON.stringify(payload))],
  isError: false,
}};

/** Map a db list result to JSON records, or pass the db error through. */
export const mapListToJson = <T>(
  result: Result<readonly T[], DbError>,
  toJson: (item: T) => Record<string, unknown>
): Result<Array<Record<string, unknown>>, DbError> =>
  result.ok ? success(result.value.map(toJson)) : result;

/** Build a successful JSON tool result from a db list result. */
export const listJsonResult = <T>(
  result: Result<readonly T[], DbError>,
  key: string,
  toJson: (item: T) => Record<string, unknown>
): CallToolResult => {
  if (!result.ok) {return makeErrorResult(result.error);}
  return jsonResult({ [key]: result.value.map(toJson) });
};

/** Error message when a tool call omits its `action` argument. */
export const MISSING_ACTION_MESSAGE: string = "missing_parameter: action is required";

/** Extract the `action` string argument, or an error result when missing. */
export const requireActionArg = (args: Record<string, unknown>): string | CallToolResult => {
  const actionArg: unknown = args.action;
  return typeof actionArg === "string" ? actionArg : errorContent(MISSING_ACTION_MESSAGE);
};

/** Read an optional string argument, or null when absent. */
export const optionalString = (args: Record<string, unknown>, field: string): string | null => {
  const value: unknown = args[field];
  return typeof value === "string" ? value : null;
};

/** Build an error result for an unrecognized action. */
export const unknownActionError = (action: string): CallToolResult =>
  errorContent(`Unknown action: ${action}`);

/** Action argument plus a logger scoped to it. */
type ActionOk = {
  readonly isError: false;
  readonly action: string;
  readonly log: Logger;
};

/** Failure to extract the action argument. */
type ActionErr = {
  readonly isError: true;
  readonly result: CallToolResult;
};

export type ActionContext = ActionErr | ActionOk;

/** Extract the required `action` argument and a logger scoped to it. */
export const actionContext = (
  args: Record<string, unknown>,
  logger: Logger,
  tool: string,
  logFields: Record<string, unknown>
): ActionContext => {
  const actionOrError: string | CallToolResult = requireActionArg(args);
  if (typeof actionOrError !== "string") {return { isError: true, result: actionOrError };}
  return { isError: false, action: actionOrError, log: logger.child({ tool, action: actionOrError, ...logFields }) };
};

/** Sentence stating that over-limit input is rejected outright, never truncated. */
export const rejectedNeverTruncated = (subject: string): string =>
  `Longer ${subject} are REJECTED, never truncated. `;

/** Shared shape of every tool's registration config. */
export type ToolConfig<Schema> = {
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Schema;
  readonly outputSchema: null;
  readonly annotations: null;
};

/** Build a tool config, filling the shared null output/annotation fields. */
export const toolConfig = <Schema>(
  title: string,
  description: string,
  inputSchema: Schema
): ToolConfig<Schema> => ({ title, description, inputSchema, outputSchema: null, annotations: null });

/** Resolve a caller identity and pass it to `fn`, or short-circuit with an error result. */
export const withResolvedAgent = async <T>(
  db: TooManyCooksDb,
  args: Record<string, unknown>,
  getSession: SessionGetter,
  fn: (agentName: string, agentKey: string) => Promise<T>
): Promise<T | CallToolResult> => {
  const identity: IdentityResult = await resolveIdentity(db, args, getSession);
  if (identity.isError) {return identity.result;}
  return await fn(identity.agentName, identity.agentKey);
};

// ---------------------------------------------------------------------------
// Input schemas [MCP-TOOL-LIMITS]
// ---------------------------------------------------------------------------

/** Optional agent-key override shared by every tool that acts as an agent. */
export const agentKeyField: z.ZodOptional<z.ZodString> = z.string().optional().describe(
  "Agent key for authentication (optional, uses session if omitted)",
);

/** Rejection text for an over-long field: states the actual length AND the limit. */
const tooLongMessage = (field: string, input: unknown, max: number): string =>
  `${field} is ${String(typeof input === "string" ? input.length : 0)} characters; ` +
  `the limit is ${String(max)}. Shorten it and resend.`;

/** Optional text field with a hard character limit, enforced on the wire. */
export const limitedText = (field: string, max: number, purpose: string): z.ZodOptional<z.ZodString> =>
  z.string()
    .max(max, { error: (issue: { readonly input?: unknown }): string => tooLongMessage(field, issue.input, max) })
    .optional()
    .describe(`${purpose} HARD LIMIT: ${String(max)} characters.`);

/** JSON Schema of a tool's zod input shape — derived, never hand-written. */
export const toJsonSchema = (shape: z.ZodRawShape): Record<string, unknown> =>
  z.toJSONSchema(z.object(shape));
