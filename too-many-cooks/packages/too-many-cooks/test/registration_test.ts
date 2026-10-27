/// Tests for agent registration.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ERR_VALIDATION,
} from "too-many-cooks-core";
import { bindTestDb } from "./support/db_fixture.js";
import { assertFieldSetEquals, expectErr, expectOk } from "./support/assertions.js";

const TEST_DB_PATH = ".test_registration.db";

describe("registration", () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  it("register creates agent with key", async () => {
    const reg = expectOk(await testDb.db().register("test-agent"), "reg must be ok");
    assert.strictEqual(reg.agentName, "test-agent");
    assert.strictEqual(reg.agentKey.length, 64);
  });

  it("register fails for duplicate name", async () => {
    await testDb.db().register("duplicate-agent");
    const error = expectErr(
      await testDb.db().register("duplicate-agent"),
      "reg must fail",
    );
    assert.strictEqual(error.code, ERR_VALIDATION);
    assert.ok(error.message.includes("already registered"));
  });

  it("register fails for empty name", async () => {
    const error = expectErr(await testDb.db().register(""), "reg must fail");
    assert.strictEqual(error.code, ERR_VALIDATION);
    assert.ok(error.message.includes("1-50"));
  });

  it("register fails for name over 50 chars", async () => {
    const error = expectErr(await testDb.db().register("a".repeat(51)), "reg must fail");
    assert.strictEqual(error.code, ERR_VALIDATION);
    assert.ok(error.message.includes("1-50"));
  });

  it("register accepts name of exactly 50 chars", async () => {
    const result = await testDb.db().register("a".repeat(50));
    assert.strictEqual(result.ok, true);
  });

  it("listAgents returns registered agents", async () => {
    await testDb.db().register("agent1");
    await testDb.db().register("agent2");
    const agents = expectOk(await testDb.db().listAgents(), "list must be ok");
    assertFieldSetEquals(agents, (a) => a.agentName, ["agent1", "agent2"]);
  });
});
