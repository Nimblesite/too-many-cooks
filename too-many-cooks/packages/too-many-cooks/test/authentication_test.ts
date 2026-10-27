/// Tests for agent authentication.

import { describe, it } from "node:test";
import assert from "node:assert";

import type { AgentIdentity } from "too-many-cooks-core";
import { ERR_UNAUTHORIZED } from "too-many-cooks-core";
import { type RegisteredAgent, bindTestDb } from "./support/db_fixture.js";
import { expectErr, expectOk } from "./support/assertions.js";

const TEST_DB_PATH = ".test_authentication.db";

/** One expected authentication failure: what to register, then what to present. */
type AuthFailureCase = {
  readonly name: string;
  readonly agentName: string;
  readonly presentKey: string;
  readonly registerFirst: boolean;
};

const AUTH_FAILURE_CASES: readonly AuthFailureCase[] = [
  { name: "authenticate fails with invalid key", agentName: "auth-agent2", presentKey: "wrong-key", registerFirst: true },
  { name: "authenticate fails for nonexistent agent", agentName: "nonexistent", presentKey: "any-key", registerFirst: false },
];

describe("authentication", () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  /** Registers `label` and authenticates it; returns both values. */
  const registerAndAuthenticate = async (
    label: string,
  ): Promise<{ readonly reg: RegisteredAgent; readonly agent: AgentIdentity }> => {
    const reg = expectOk(await testDb.db().register(label), "reg must be ok");
    const agent = expectOk(
      await testDb.db().authenticate(reg.agentName, reg.agentKey),
      "authenticate must be ok",
    );
    return { reg, agent };
  };

  it("authenticate succeeds with valid credentials", async () => {
    const { agent } = await registerAndAuthenticate("auth-agent");
    assert.strictEqual(agent.agentName, "auth-agent");
  });

  for (const testCase of AUTH_FAILURE_CASES) {
    it(testCase.name, async () => {
      if (testCase.registerFirst) {
        await testDb.db().register(testCase.agentName);
      }

      const error = expectErr(
        await testDb.db().authenticate(testCase.agentName, testCase.presentKey),
        "authenticate must fail",
      );
      assert.strictEqual(error.code, ERR_UNAUTHORIZED);
    });
  }

  it("authenticate updates last_active timestamp", async () => {
    const { reg, agent: firstAgent } = await registerAndAuthenticate("timestamp-agent");

    const secondAgent = expectOk(
      await testDb.db().authenticate(reg.agentName, reg.agentKey),
      "secondAgent must be ok",
    );

    assert.ok(secondAgent.lastActive >= firstAgent.lastActive);
  });
});
