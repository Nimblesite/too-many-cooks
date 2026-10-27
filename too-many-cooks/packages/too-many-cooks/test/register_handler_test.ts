/// Tests for register tool handler (direct import, not via spawned server).

import { describe, it } from "node:test";
import assert from "node:assert";
import type { SessionIdentity } from "too-many-cooks-core";
import { bindTestDb, registerAgent } from "./support/db_fixture.js";
import {
  createSessionCapture,
  parseToolJson,
  registerHandlerFor,
} from "./support/handlers.js";

const TEST_DB_PATH = ".test_register_handler.db";

/** Session setter that never records (for negative-path tests). */
const noopSetSession = (): void => { /* noop */ };

describe("register handler", () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  /** Registers `name` through a capturing handler; returns payload + session. */
  const registerByName = async (
    name: string,
  ): Promise<{
    readonly parsed: Record<string, unknown>;
    readonly session: SessionIdentity | null;
  }> => {
    const capture = createSessionCapture();
    const handler = registerHandlerFor(testDb.db(), capture.setSession);
    const result = await handler({ name }, {});
    assert.strictEqual(result.isError, false);
    return { parsed: parseToolJson(result), session: capture.session() };
  };

  /** Runs the register handler expecting a tool error; returns its payload. */
  const expectHandlerError = async (
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const handler = registerHandlerFor(testDb.db(), noopSetSession);
    const result = await handler(args, {});
    assert.strictEqual(result.isError, true);
    return parseToolJson(result);
  };

  it("registers a new agent with name", async () => {
    const { parsed, session } = await registerByName("test-agent");
    assert.strictEqual(parsed.agent_name, "test-agent");
    assert.strictEqual(typeof parsed.agent_key, "string");
    assert.notStrictEqual(session, null);
    if (session !== null) {
      assert.strictEqual(session.agentName, "test-agent");
    }
  });

  it("reconnects with existing key", async () => {
    const { agentKey } = await registerAgent(testDb.db(), "reconnect-agent");

    const capture = createSessionCapture();
    const handler = registerHandlerFor(testDb.db(), capture.setSession);
    const result = await handler({ key: agentKey }, {});
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.agent_name, "reconnect-agent");
    assert.strictEqual(parsed.agent_key, agentKey);
    assert.notStrictEqual(capture.session(), null);
  });

  it("fails when both name and key provided", async () => {
    const parsed = await expectHandlerError({ name: "agent", key: "some-key" });
    assert.strictEqual(typeof parsed.error, "string");
  });

  it("fails when neither name nor key provided", async () => {
    const parsed = await expectHandlerError({});
    assert.strictEqual(typeof parsed.error, "string");
  });

  it("fails reconnect with invalid key", async () => {
    await expectHandlerError({ key: "nonexistent-key" });
  });

  it("re-registers an already registered name", async () => {
    await registerAgent(testDb.db(), "duplicate-agent");

    const { parsed, session } = await registerByName("duplicate-agent");
    assert.strictEqual(parsed.agent_name, "duplicate-agent");
    assert.notStrictEqual(session, null);
  });
});
