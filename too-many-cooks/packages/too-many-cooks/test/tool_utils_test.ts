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
import { firstTextBlock } from "./support/handlers.js";
import { parseJsonRecord } from "./support/json.js";

const TEST_DB_PATH = ".test_tool_utils.db";

describe("resolveIdentity", () => {
  const agentDb = bindAgentDb(TEST_DB_PATH, "utils-agent");

  it("resolves from session when no agent_key in args", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const getSession = (): SessionIdentity => ({ agentName, agentKey });
    const result = await resolveIdentity(db, {}, getSession);
    assert.strictEqual(result.isError, false);
    if (result.isError) { throw new Error("expected ok"); }
    assert.strictEqual(result.agentName, agentName);
    assert.strictEqual(result.agentKey, agentKey);
  });

  it("resolves from agent_key override", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const getSession = (): SessionIdentity | null => null;
    const result = await resolveIdentity(db, { agent_key: agentKey }, getSession);
    assert.strictEqual(result.isError, false);
    if (result.isError) { throw new Error("expected ok"); }
    assert.strictEqual(result.agentName, agentName);
    assert.strictEqual(result.agentKey, agentKey);
  });

  it("returns error when agent_key is invalid", async () => {
    const db = agentDb.db();
    const getSession = (): SessionIdentity | null => null;
    const result = await resolveIdentity(db, { agent_key: "bad-key" }, getSession);
    assert.strictEqual(result.isError, true);
  });

  it("returns error when no session and no agent_key", async () => {
    const db = agentDb.db();
    const getSession = (): SessionIdentity | null => null;
    const result = await resolveIdentity(db, {}, getSession);
    assert.strictEqual(result.isError, true);
    if (!result.isError) { throw new Error("expected error"); }
    assert.strictEqual(result.result.isError, true);
    const block = result.result.content[0];
    assert.ok(block !== undefined, "error result must carry content");
    assert.ok(block.text.includes("not_registered"));
  });

  it("ignores non-string agent_key in args", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const getSession = (): SessionIdentity => ({ agentName, agentKey });
    const result = await resolveIdentity(db, { agent_key: 123 }, getSession);
    assert.strictEqual(result.isError, false);
    if (result.isError) { throw new Error("expected ok"); }
    assert.strictEqual(result.agentName, agentName);
  });
});

describe("error helpers", () => {
  it("makeErrorResult creates error with db error json", () => {
    const result = makeErrorResult({ code: "test_error", message: "something went wrong" });
    assert.strictEqual(result.isError, true);
    const parsed = parseJsonRecord(firstTextBlock(result));
    assert.strictEqual(parsed.code, "test_error");
    assert.strictEqual(parsed.message, "something went wrong");
  });

  it("errorContent creates error with message string", () => {
    const result = errorContent("bad input");
    assert.strictEqual(result.isError, true);
    const parsed = parseJsonRecord(firstTextBlock(result));
    assert.strictEqual(parsed.error, "bad input");
  });
});
