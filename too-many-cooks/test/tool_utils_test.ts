/// Tests for tool_utils - resolveIdentity, error helpers.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import {
  type TooManyCooksDb,
  createDataConfig,
  createDb,
} from "../lib/src/data/data.js";
import type { SessionIdentity } from "../lib/src/types.js";
import { resolveIdentity, makeErrorResult, errorContent } from "../lib/src/tools/tool_utils.js";

const TEST_DB_PATH = ".test_tool_utils.db";

const deleteIfExists = (filePath: string): void => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore
  }
};

describe("resolveIdentity", () => {
  let db: TooManyCooksDb | undefined;
  let agentName = "";
  let agentKey = "";

  beforeEach(() => {
    deleteIfExists(TEST_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { throw new Error("expected ok"); }
    db = result.value;

    const regResult = db.register("utils-agent");
    if (!regResult.ok) { throw new Error("expected ok"); }
    agentName = regResult.value.agentName;
    agentKey = regResult.value.agentKey;
  });

  afterEach(() => {
    db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  it("resolves from session when no agent_key in args", () => {
    if (!db) { throw new Error("expected db"); }
    const getSession = (): SessionIdentity => ({ agentName, agentKey });
    const result = resolveIdentity(db, {}, getSession);
    assert.strictEqual(result.isError, false);
    if (result.isError) { throw new Error("expected ok"); }
    assert.strictEqual(result.agentName, agentName);
    assert.strictEqual(result.agentKey, agentKey);
  });

  it("resolves from agent_key override", () => {
    if (!db) { throw new Error("expected db"); }
    const getSession = (): SessionIdentity | null => null;
    const result = resolveIdentity(db, { agent_key: agentKey }, getSession);
    assert.strictEqual(result.isError, false);
    if (result.isError) { throw new Error("expected ok"); }
    assert.strictEqual(result.agentName, agentName);
    assert.strictEqual(result.agentKey, agentKey);
  });

  it("returns error when agent_key is invalid", () => {
    if (!db) { throw new Error("expected db"); }
    const getSession = (): SessionIdentity | null => null;
    const result = resolveIdentity(db, { agent_key: "bad-key" }, getSession);
    assert.strictEqual(result.isError, true);
  });

  it("returns error when no session and no agent_key", () => {
    if (!db) { throw new Error("expected db"); }
    const getSession = (): SessionIdentity | null => null;
    const result = resolveIdentity(db, {}, getSession);
    assert.strictEqual(result.isError, true);
    if (!result.isError) { throw new Error("expected error"); }
    assert.strictEqual(result.result.isError, true);
    assert.ok(result.result.content[0].text.includes("not_registered"));
  });

  it("ignores non-string agent_key in args", () => {
    if (!db) { throw new Error("expected db"); }
    const getSession = (): SessionIdentity => ({ agentName, agentKey });
    const result = resolveIdentity(db, { agent_key: 123 }, getSession);
    assert.strictEqual(result.isError, false);
    if (result.isError) { throw new Error("expected ok"); }
    assert.strictEqual(result.agentName, agentName);
  });
});

describe("error helpers", () => {
  it("makeErrorResult creates error with db error json", () => {
    const result = makeErrorResult({ code: "test_error", message: "something went wrong" });
    assert.strictEqual(result.isError, true);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.code, "test_error");
    assert.strictEqual(parsed.message, "something went wrong");
  });

  it("errorContent creates error with message string", () => {
    const result = errorContent("bad input");
    assert.strictEqual(result.isError, true);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.error, "bad input");
  });
});
