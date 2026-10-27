/// Tests for tool_utils - resolveIdentity, error helpers.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  resolveIdentity,
  makeErrorResult,
  errorContent,
} from "too-many-cooks-core";
import type { SessionIdentity } from "too-many-cooks-core";
import { bindAgentDb } from "./support/db_fixture.js";
import { agentSession, errorToolJson } from "./support/handlers.js";

const TEST_DB_PATH = ".test_tool_utils.db";
const NON_STRING_KEY = 123;

/** A resolved identity pair. */
type ResolvedIdentity = { readonly agentName: string; readonly agentKey: string };

describe("resolveIdentity", () => {
  const agentDb = bindAgentDb(TEST_DB_PATH, "utils-agent");

  /** Resolves the identity, asserting the call succeeded. */
  const resolveOk = async (
    args: Record<string, unknown>,
    getSession: () => SessionIdentity | null,
  ): Promise<ResolvedIdentity> => {
    const result = await resolveIdentity(agentDb.db(), args, getSession);
    assert.strictEqual(result.isError, false);
    if (result.isError) { throw new Error("expected ok"); }
    return { agentName: result.agentName, agentKey: result.agentKey };
  };

  const noSession = (): SessionIdentity | null => null;

  it("resolves from session when no agent_key in args", async () => {
    const agent = agentDb.agent();
    const resolved = await resolveOk({}, agentSession(agent));
    assert.strictEqual(resolved.agentName, agent.agentName);
    assert.strictEqual(resolved.agentKey, agent.agentKey);
  });

  it("resolves from agent_key override", async () => {
    const agent = agentDb.agent();
    const resolved = await resolveOk({ agent_key: agent.agentKey }, noSession);
    assert.strictEqual(resolved.agentName, agent.agentName);
    assert.strictEqual(resolved.agentKey, agent.agentKey);
  });

  it("returns error when agent_key is invalid", async () => {
    const result = await resolveIdentity(agentDb.db(), { agent_key: "bad-key" }, noSession);
    assert.strictEqual(result.isError, true);
  });

  it("returns error when no session and no agent_key", async () => {
    const result = await resolveIdentity(agentDb.db(), {}, noSession);
    assert.strictEqual(result.isError, true);
    if (!result.isError) { throw new Error("expected error"); }
    assert.strictEqual(result.result.isError, true);
    const block = result.result.content[0];
    assert.ok(block !== undefined, "error result must carry content");
    assert.ok(block.text.includes("not_registered"));
  });

  it("ignores non-string agent_key in args", async () => {
    const agent = agentDb.agent();
    const resolved = await resolveOk({ agent_key: NON_STRING_KEY }, agentSession(agent));
    assert.strictEqual(resolved.agentName, agent.agentName);
  });
});

describe("error helpers", () => {
  it("makeErrorResult creates error with db error json", () => {
    const parsed = errorToolJson(
      makeErrorResult({ code: "test_error", message: "something went wrong" }),
    );
    assert.strictEqual(parsed.code, "test_error");
    assert.strictEqual(parsed.message, "something went wrong");
  });

  it("errorContent creates error with message string", () => {
    const parsed = errorToolJson(errorContent("bad input"));
    assert.strictEqual(parsed.error, "bad input");
  });
});
