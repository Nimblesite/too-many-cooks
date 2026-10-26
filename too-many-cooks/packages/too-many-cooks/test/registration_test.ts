/// Tests for agent registration.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ERR_VALIDATION,
} from "too-many-cooks-core";
import { bindTestDb } from "./support/db_fixture.js";

const TEST_DB_PATH = ".test_registration.db";

describe("registration", () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  it("register creates agent with key", async () => {
    const db = testDb.db();
    const result = await db.register("test-agent");
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const reg = result.value;
    assert.strictEqual(reg.agentName, "test-agent");
    assert.strictEqual(reg.agentKey.length, 64);
  });

  it("register fails for duplicate name", async () => {
    const db = testDb.db();
    await db.register("duplicate-agent");
    const result = await db.register("duplicate-agent");
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_VALIDATION);
    assert.ok(result.error.message.includes("already registered"));
  });

  it("register fails for empty name", async () => {
    const db = testDb.db();
    const result = await db.register("");
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_VALIDATION);
    assert.ok(result.error.message.includes("1-50"));
  });

  it("register fails for name over 50 chars", async () => {
    const db = testDb.db();
    const result = await db.register("a".repeat(51));
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_VALIDATION);
    assert.ok(result.error.message.includes("1-50"));
  });

  it("register accepts name of exactly 50 chars", async () => {
    const db = testDb.db();
    const result = await db.register("a".repeat(50));
    assert.strictEqual(result.ok, true);
  });

  it("listAgents returns registered agents", async () => {
    const db = testDb.db();
    await db.register("agent1");
    await db.register("agent2");
    const result = await db.listAgents();
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const agents = result.value;
    assert.strictEqual(agents.length, 2);
    assert.deepStrictEqual(
      new Set(agents.map((a) => a.agentName)),
      new Set(["agent1", "agent2"]),
    );
  });
});
