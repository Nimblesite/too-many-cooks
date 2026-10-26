/// Tests for register tool handler (direct import, not via spawned server).

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createRegisterHandler,
} from "too-many-cooks-core";
import type { SessionIdentity } from "too-many-cooks-core";
import { bindTestDb, registerAgent } from "./support/db_fixture.js";
import {
  createSessionCapture,
  createTestEmitter,
  createTestLogger,
  parseToolJson,
} from "./support/handlers.js";

const TEST_DB_PATH = ".test_register_handler.db";

describe("register handler", () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  it("registers a new agent with name", async () => {
    const db = testDb.db();
    const capture = createSessionCapture();
    const handler = createRegisterHandler(db, createTestEmitter(), createTestLogger(), capture.setSession);
    const result = await handler({ name: "test-agent" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.agent_name, "test-agent");
    assert.strictEqual(typeof parsed.agent_key, "string");
    const session: SessionIdentity | null = capture.session();
    assert.notStrictEqual(session, null);
    if (session !== null) {
      assert.strictEqual(session.agentName, "test-agent");
    }
  });

  it("reconnects with existing key", async () => {
    const db = testDb.db();
    const { agentKey } = await registerAgent(db, "reconnect-agent");

    const capture = createSessionCapture();
    const handler = createRegisterHandler(db, createTestEmitter(), createTestLogger(), capture.setSession);
    const result = await handler({ key: agentKey }, {});
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.agent_name, "reconnect-agent");
    assert.strictEqual(parsed.agent_key, agentKey);
    assert.notStrictEqual(capture.session(), null);
  });

  it("fails when both name and key provided", async () => {
    const db = testDb.db();
    const setSession = (): void => { /* noop */ };
    const handler = createRegisterHandler(db, createTestEmitter(), createTestLogger(), setSession);
    const result = await handler({ name: "agent", key: "some-key" }, {});
    assert.strictEqual(result.isError, true);
    const parsed = parseToolJson(result);
    assert.strictEqual(typeof parsed.error, "string");
  });

  it("fails when neither name nor key provided", async () => {
    const db = testDb.db();
    const setSession = (): void => { /* noop */ };
    const handler = createRegisterHandler(db, createTestEmitter(), createTestLogger(), setSession);
    const result = await handler({}, {});
    assert.strictEqual(result.isError, true);
    const parsed = parseToolJson(result);
    assert.strictEqual(typeof parsed.error, "string");
  });

  it("fails reconnect with invalid key", async () => {
    const db = testDb.db();
    const setSession = (): void => { /* noop */ };
    const handler = createRegisterHandler(db, createTestEmitter(), createTestLogger(), setSession);
    const result = await handler({ key: "nonexistent-key" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("re-registers an already registered name", async () => {
    const db = testDb.db();
    await registerAgent(db, "duplicate-agent");

    const capture = createSessionCapture();
    const handler = createRegisterHandler(db, createTestEmitter(), createTestLogger(), capture.setSession);
    const result = await handler({ name: "duplicate-agent" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.agent_name, "duplicate-agent");
    assert.notStrictEqual(capture.session(), null);
  });
});
