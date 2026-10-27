/// Registration, authentication, and activation contract tests.

import { it } from "node:test";
import assert from "node:assert/strict";

import type { AgentIdentity, AgentRegistration } from "../types.gen.js";
import {
  EXPECTED_KEY_LENGTH,
  MAX_AGENT_NAME_LENGTH,
  OVER_MAX_AGENT_NAME_LENGTH,
  assertContainsAll,
  assertError,
  assertKeyBelongsTo,
  assertOk,
  cleanupInstance,
  describeSuite,
  freshInstance,
  registerAgent,
  registerAgents,
  registerAndAuthenticate,
  registerPair,
  registerRepeatedName,
  unwrap,
} from "./setup.test.js";
import type { DbFactory, DbInstance } from "./setup.test.js";

/** Run registration contract tests. */
export const runRegistrationTests = (createTestDb: DbFactory): void => {
  describeSuite(createTestDb, "TooManyCooksDb contract: registration", freshInstance, cleanupInstance, (getInst: () => DbInstance): void => {
    it("register creates agent with unique hex key", async (): Promise<void> => {
      const reg: AgentRegistration = await registerAgent(getInst(), "agent1");
      assert.strictEqual(reg.agentName, "agent1");
      assert.strictEqual(reg.agentKey.length, EXPECTED_KEY_LENGTH);
    });

    it("register fails for duplicate active name", async (): Promise<void> => {
      await registerAgent(getInst(), "agent1");
      const result = await getInst().db.register("agent1");
      assert.strictEqual(result.ok, false);
    });

    it("register fails for empty name", async (): Promise<void> => {
      assertError(await getInst().db.register(""), "VALIDATION");
    });

    it("register fails for name over 50 chars", async (): Promise<void> => {
      assertError(await registerRepeatedName(getInst(), OVER_MAX_AGENT_NAME_LENGTH), "VALIDATION");
    });

    it("register accepts name of exactly 50 chars", async (): Promise<void> => {
      assertOk(await registerRepeatedName(getInst(), MAX_AGENT_NAME_LENGTH));
    });

    it("two registrations produce different keys", async (): Promise<void> => {
      const [reg1, reg2]: readonly [AgentRegistration, AgentRegistration] = await registerPair(getInst(), "agent1", "agent2");
      assert.notStrictEqual(reg1.agentKey, reg2.agentKey);
    });

    it("listAgents returns registered agents", async (): Promise<void> => {
      await registerAgents(getInst(), ["agent1", "agent2"]);
      const agents: readonly AgentIdentity[] = unwrap(await getInst().db.listAgents());
      assertContainsAll(agents, (agent: AgentIdentity): string => {return agent.agentName}, ["agent1", "agent2"]);
    });
  });
};

/** Run authentication contract tests. */
export const runAuthenticationTests = (createTestDb: DbFactory): void => {
  describeSuite(createTestDb, "TooManyCooksDb contract: authentication", freshInstance, cleanupInstance, (getInst: () => DbInstance): void => {
    it("authenticate succeeds with correct key", async (): Promise<void> => {
      const { auth }: { readonly reg: AgentRegistration; readonly auth: AgentIdentity } = await registerAndAuthenticate(getInst(), "agent1");
      assert.strictEqual(auth.agentName, "agent1");
    });

    it("authenticate fails with wrong key", async (): Promise<void> => {
      await registerAgent(getInst(), "agent1");
      assertError(await getInst().db.authenticate("agent1", "wrong-key"), "UNAUTHORIZED");
    });

    it("authenticate fails for nonexistent agent", async (): Promise<void> => {
      assertError(await getInst().db.authenticate("ghost", "any-key"), "UNAUTHORIZED");
    });

    it("authenticate updates last_active timestamp", async (): Promise<void> => {
      const { reg, auth: first }: { readonly reg: AgentRegistration; readonly auth: AgentIdentity } = await registerAndAuthenticate(getInst(), "agent1");
      const second: AgentIdentity = unwrap(await getInst().db.authenticate("agent1", reg.agentKey));
      assert.ok(second.lastActive >= first.lastActive);
    });

    it("lookupByKey returns agent name", async (): Promise<void> => {
      const reg: AgentRegistration = await registerAgent(getInst(), "agent1");
      await assertKeyBelongsTo(getInst(), reg.agentKey, "agent1");
    });

    it("lookupByKey fails for invalid key", async (): Promise<void> => {
      assertError(await getInst().db.lookupByKey("invalid-key"), "UNAUTHORIZED");
    });
  });
};

/** Run activation contract tests. */
export const runActivationTests = (createTestDb: DbFactory): void => {
  describeSuite(createTestDb, "TooManyCooksDb contract: activation", freshInstance, cleanupInstance, (getInst: () => DbInstance): void => {
    it("activate and deactivate agent", async (): Promise<void> => {
      await registerAgent(getInst(), "agent1");
      assertOk(await getInst().db.activate("agent1"));
      assertOk(await getInst().db.deactivate("agent1"));
    });

    it("activate fails for nonexistent agent", async (): Promise<void> => {
      assertError(await getInst().db.activate("ghost"), "NOT_FOUND");
    });

    it("deactivate fails for nonexistent agent", async (): Promise<void> => {
      assertError(await getInst().db.deactivate("ghost"), "NOT_FOUND");
    });

    it("deactivateAll succeeds", async (): Promise<void> => {
      await registerAgents(getInst(), ["agent1", "agent2"]);
      await getInst().db.activate("agent1");
      await getInst().db.activate("agent2");
      assertOk(await getInst().db.deactivateAll());
    });

    it("deactivateAll succeeds with no agents", async (): Promise<void> => {
      assertOk(await getInst().db.deactivateAll());
    });
  });
};
