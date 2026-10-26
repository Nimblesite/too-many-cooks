/// Tests for agent authentication.

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  ERR_UNAUTHORIZED,
} from "too-many-cooks-core";
import { bindTestDb } from "./support/db_fixture.js";
import { expectErr, expectOk } from "./support/assertions.js";

const TEST_DB_PATH = ".test_authentication.db";

describe("authentication", () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  it("authenticate succeeds with valid credentials", async () => {
    const reg = expectOk(await testDb.db().register("auth-agent"), "reg must be ok");

    const agent = expectOk(
      await testDb.db().authenticate(reg.agentName, reg.agentKey),
      "agent must be ok",
    );
    assert.strictEqual(agent.agentName, "auth-agent");
  });

  it("authenticate fails with invalid key", async () => {
    await testDb.db().register("auth-agent2");

    const error = expectErr(
      await testDb.db().authenticate("auth-agent2", "wrong-key"),
      "authenticate must fail",
    );
    assert.strictEqual(error.code, ERR_UNAUTHORIZED);
  });

  it("authenticate fails for nonexistent agent", async () => {
    const error = expectErr(
      await testDb.db().authenticate("nonexistent", "any-key"),
      "authenticate must fail",
    );
    assert.strictEqual(error.code, ERR_UNAUTHORIZED);
  });

  it("authenticate updates last_active timestamp", async () => {
    const reg = expectOk(await testDb.db().register("timestamp-agent"), "reg must be ok");

    const firstAgent = expectOk(
      await testDb.db().authenticate(reg.agentName, reg.agentKey),
      "firstAgent must be ok",
    );

    // Small delay to ensure timestamp changes
    const secondAgent = expectOk(
      await testDb.db().authenticate(reg.agentName, reg.agentKey),
      "secondAgent must be ok",
    );

    assert.ok(secondAgent.lastActive >= firstAgent.lastActive);
  });
});
