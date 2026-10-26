/// Registration, authentication, and activation contract tests.

import { it } from "node:test";
import assert from "node:assert/strict";

import type { TooManyCooksDb } from "../db-interface.js";
import type { AgentIdentity, AgentRegistration } from "../types.gen.js";
import {
  EXPECTED_KEY_LENGTH,
  MAX_AGENT_NAME_LENGTH,
  OVER_MAX_AGENT_NAME_LENGTH,
  assertError,
  cleanupInstance,
  describeSuite,
  freshInstance,
  unwrap,
} from "./setup.test.js";
import type { DbFactory, DbInstance } from "./setup.test.js";

/** Run registration contract tests. */
export const runRegistrationTests = (createTestDb: DbFactory): void => {
  describeSuite(createTestDb, "TooManyCooksDb contract: registration", freshInstance, cleanupInstance, (getInst: () => DbInstance): void => {
    it("register creates agent with unique hex key", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await getInst().db.register("agent1"));
      assert.strictEqual(reg.agentName, "agent1");
      assert.strictEqual(reg.agentKey.length, EXPECTED_KEY_LENGTH);
    });

    it("register fails for duplicate active name", async (): Promise<void> => {
      unwrap(await getInst().db.register("agent1"));
      const result: Awaited<ReturnType<TooManyCooksDb["register"]>> = await getInst().db.register("agent1");
      assert.strictEqual(result.ok, false);
    });

    it("register fails for empty name", async (): Promise<void> => {
      const result: Awaited<ReturnType<TooManyCooksDb["register"]>> = await getInst().db.register("");
      assertError(result, "VALIDATION");
    });

    it("register fails for name over 50 chars", async (): Promise<void> => {
      const result: Awaited<ReturnType<TooManyCooksDb["register"]>> = await getInst().db.register("a".repeat(OVER_MAX_AGENT_NAME_LENGTH));
      assertError(result, "VALIDATION");
    });

    it("register accepts name of exactly 50 chars", async (): Promise<void> => {
      const result: Awaited<ReturnType<TooManyCooksDb["register"]>> = await getInst().db.register("a".repeat(MAX_AGENT_NAME_LENGTH));
      assert.strictEqual(result.ok, true);
    });

    it("two registrations produce different keys", async (): Promise<void> => {
      const reg1: AgentRegistration = unwrap(await getInst().db.register("agent1"));
      const reg2: AgentRegistration = unwrap(await getInst().db.register("agent2"));
      assert.notStrictEqual(reg1.agentKey, reg2.agentKey);
    });

    it("listAgents returns registered agents", async (): Promise<void> => {
      unwrap(await getInst().db.register("agent1"));
      unwrap(await getInst().db.register("agent2"));
      const agents: readonly AgentIdentity[] = unwrap(await getInst().db.listAgents());
      const names: Set<string> = new Set<string>(agents.map((agent: AgentIdentity): string => {return agent.agentName}));
      assert.ok(names.has("agent1"));
      assert.ok(names.has("agent2"));
    });
  });
};

/** Run authentication contract tests. */
export const runAuthenticationTests = (createTestDb: DbFactory): void => {
  describeSuite(createTestDb, "TooManyCooksDb contract: authentication", freshInstance, cleanupInstance, (getInst: () => DbInstance): void => {
    it("authenticate succeeds with correct key", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await getInst().db.register("agent1"));
      const auth: AgentIdentity = unwrap(await getInst().db.authenticate("agent1", reg.agentKey));
      assert.strictEqual(auth.agentName, "agent1");
    });

    it("authenticate fails with wrong key", async (): Promise<void> => {
      unwrap(await getInst().db.register("agent1"));
      assertError(await getInst().db.authenticate("agent1", "wrong-key"), "UNAUTHORIZED");
    });

    it("authenticate fails for nonexistent agent", async (): Promise<void> => {
      assertError(await getInst().db.authenticate("ghost", "any-key"), "UNAUTHORIZED");
    });

    it("authenticate updates last_active timestamp", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await getInst().db.register("agent1"));
      const first: AgentIdentity = unwrap(await getInst().db.authenticate("agent1", reg.agentKey));
      const second: AgentIdentity = unwrap(await getInst().db.authenticate("agent1", reg.agentKey));
      assert.ok(second.lastActive >= first.lastActive);
    });

    it("lookupByKey returns agent name", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await getInst().db.register("agent1"));
      const name: string = unwrap(await getInst().db.lookupByKey(reg.agentKey));
      assert.strictEqual(name, "agent1");
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
      unwrap(await getInst().db.register("agent1"));
      const activateResult: Awaited<ReturnType<TooManyCooksDb["activate"]>> = await getInst().db.activate("agent1");
      assert.strictEqual(activateResult.ok, true);

      const deactivateResult: Awaited<ReturnType<TooManyCooksDb["deactivate"]>> = await getInst().db.deactivate("agent1");
      assert.strictEqual(deactivateResult.ok, true);
    });

    it("activate fails for nonexistent agent", async (): Promise<void> => {
      assertError(await getInst().db.activate("ghost"), "NOT_FOUND");
    });

    it("deactivate fails for nonexistent agent", async (): Promise<void> => {
      assertError(await getInst().db.deactivate("ghost"), "NOT_FOUND");
    });

    it("deactivateAll succeeds", async (): Promise<void> => {
      unwrap(await getInst().db.register("agent1"));
      unwrap(await getInst().db.register("agent2"));
      await getInst().db.activate("agent1");
      await getInst().db.activate("agent2");
      const result: Awaited<ReturnType<TooManyCooksDb["deactivateAll"]>> = await getInst().db.deactivateAll();
      assert.strictEqual(result.ok, true);
    });

    it("deactivateAll succeeds with no agents", async (): Promise<void> => {
      const result: Awaited<ReturnType<TooManyCooksDb["deactivateAll"]>> = await getInst().db.deactivateAll();
      assert.strictEqual(result.ok, true);
    });
  });
};
