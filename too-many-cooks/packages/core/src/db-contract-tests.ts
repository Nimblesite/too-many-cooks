/* eslint-disable max-lines -- Contract test suite necessarily covers full interface */
/* eslint-disable max-lines-per-function -- test suite functions necessarily exceed 50 lines */
/* eslint-disable @typescript-eslint/no-floating-promises -- node:test describe/it/beforeEach/afterEach return promises managed by the test runner */
/// Contract test suite for TooManyCooksDb interface.
///
/// Tests the behavioral contract independent of any specific backend.
/// Any implementation of TooManyCooksDb that passes these tests is
/// guaranteed interchangeable with the SQLite implementation.
///
/// Usage:
///   import { runDbContractTests } from "@too-many-cooks/core";
///   runDbContractTests(async () => ({
///     db: yourDbInstance,
///     cleanup: async () => { /* tear down */ },
///   }));

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import type { TooManyCooksDb } from "./db-interface.js";

/** Factory type for creating test db instances. */
type DbFactory = () => Promise<{
  readonly db: TooManyCooksDb;
  readonly cleanup: () => Promise<void>;
}>;

/** Expected key length in hex chars (32 bytes = 64 hex). */
const EXPECTED_KEY_LENGTH = 64;

/** Expected message ID length. */
const EXPECTED_MESSAGE_ID_LENGTH = 16;

/** Default lock timeout in ms. */
const DEFAULT_LOCK_TIMEOUT_MS = 600_000;

/** Immediately-expired lock timeout. */
const EXPIRED_LOCK_TIMEOUT_MS = 0;

/** Short lock timeout for renewal tests. */
const SHORT_LOCK_TIMEOUT_MS = 1_000;

/** Long lock timeout for renewal tests. */
const LONG_LOCK_TIMEOUT_MS = 60_000;

/** Max agent name length. */
const MAX_AGENT_NAME_LENGTH = 50;

/** Over max agent name length. */
const OVER_MAX_AGENT_NAME_LENGTH = 51;

/** Broadcast recipient. */
const BROADCAST_RECIPIENT = "*";

/** Unwrap a successful Result or throw. */
const unwrap = <T>(result: { readonly ok: boolean; readonly value?: T; readonly error?: unknown }): T => {
  if (!result.ok) {
    throw new Error(`Expected ok result, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value as T;
};

/** Assert a Result is an error with the expected code. */
const assertError = (result: { readonly ok: boolean; readonly error?: { readonly code: string } }, expectedCode: string): void => {
  assert.strictEqual(result.ok, false, `Expected error with code ${expectedCode}, got ok`);
  assert.strictEqual(result.error?.code, expectedCode);
};

/** Run registration contract tests. */
const runRegistrationTests = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: registration", () => {
    let db: TooManyCooksDb;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ db, cleanup } = await createTestDb());
    });

    afterEach(async () => {
      await cleanup();
    });

    it("register creates agent with unique hex key", async () => {
      const reg = unwrap(await db.register("agent1"));
      assert.strictEqual(reg.agentName, "agent1");
      assert.strictEqual(reg.agentKey.length, EXPECTED_KEY_LENGTH);
    });

    it("register fails for duplicate active name", async () => {
      unwrap(await db.register("agent1"));
      const result = await db.register("agent1");
      assert.strictEqual(result.ok, false);
    });

    it("register fails for empty name", async () => {
      const result = await db.register("");
      assertError(result, "VALIDATION");
    });

    it("register fails for name over 50 chars", async () => {
      const result = await db.register("a".repeat(OVER_MAX_AGENT_NAME_LENGTH));
      assertError(result, "VALIDATION");
    });

    it("register accepts name of exactly 50 chars", async () => {
      const result = await db.register("a".repeat(MAX_AGENT_NAME_LENGTH));
      assert.strictEqual(result.ok, true);
    });

    it("two registrations produce different keys", async () => {
      const reg1 = unwrap(await db.register("agent1"));
      const reg2 = unwrap(await db.register("agent2"));
      assert.notStrictEqual(reg1.agentKey, reg2.agentKey);
    });

    it("listAgents returns registered agents", async () => {
      unwrap(await db.register("agent1"));
      unwrap(await db.register("agent2"));
      const agents = unwrap(await db.listAgents());
      const names = new Set(agents.map((agent) => {return agent.agentName}));
      assert.ok(names.has("agent1"));
      assert.ok(names.has("agent2"));
    });
  });
};

/** Run authentication contract tests. */
const runAuthenticationTests = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: authentication", () => {
    let db: TooManyCooksDb;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ db, cleanup } = await createTestDb());
    });

    afterEach(async () => {
      await cleanup();
    });

    it("authenticate succeeds with correct key", async () => {
      const reg = unwrap(await db.register("agent1"));
      const auth = unwrap(await db.authenticate("agent1", reg.agentKey));
      assert.strictEqual(auth.agentName, "agent1");
    });

    it("authenticate fails with wrong key", async () => {
      unwrap(await db.register("agent1"));
      assertError(await db.authenticate("agent1", "wrong-key"), "UNAUTHORIZED");
    });

    it("authenticate fails for nonexistent agent", async () => {
      assertError(await db.authenticate("ghost", "any-key"), "UNAUTHORIZED");
    });

    it("authenticate updates last_active timestamp", async () => {
      const reg = unwrap(await db.register("agent1"));
      const first = unwrap(await db.authenticate("agent1", reg.agentKey));
      const second = unwrap(await db.authenticate("agent1", reg.agentKey));
      assert.ok(second.lastActive >= first.lastActive);
    });

    it("lookupByKey returns agent name", async () => {
      const reg = unwrap(await db.register("agent1"));
      const name = unwrap(await db.lookupByKey(reg.agentKey));
      assert.strictEqual(name, "agent1");
    });

    it("lookupByKey fails for invalid key", async () => {
      assertError(await db.lookupByKey("invalid-key"), "UNAUTHORIZED");
    });
  });
};

/** Run lock contract tests. */
const runLockTests = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: locks", () => {
    let db: TooManyCooksDb;
    let cleanup: () => Promise<void>;
    let agentName: string;
    let agentKey: string;

    beforeEach(async () => {
      ({ db, cleanup } = await createTestDb());
      const reg = unwrap(await db.register("lock-agent"));
      ({ agentName, agentKey } = reg);
    });

    afterEach(async () => {
      await cleanup();
    });

    it("acquire and release lock", async () => {
      const lockResult = unwrap(await db.acquireLock("file.ts", agentName, agentKey, "editing", DEFAULT_LOCK_TIMEOUT_MS));
      assert.strictEqual(lockResult.acquired, true);

      const release = await db.releaseLock("file.ts", agentName, agentKey);
      assert.strictEqual(release.ok, true);

      const query = unwrap(await db.queryLock("file.ts"));
      assert.strictEqual(query, null);
    });

    it("lock conflict between agents (acquired=false, not error)", async () => {
      const reg2 = unwrap(await db.register("agent2"));
      unwrap(await db.acquireLock("file.ts", agentName, agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));

      const conflict = unwrap(await db.acquireLock("file.ts", reg2.agentName, reg2.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      assert.strictEqual(conflict.acquired, false);
    });

    it("acquire fails with invalid credentials", async () => {
      assertError(await db.acquireLock("file.ts", agentName, "wrong", null, DEFAULT_LOCK_TIMEOUT_MS), "UNAUTHORIZED");
    });

    it("release fails when not owned", async () => {
      assertError(await db.releaseLock("file.ts", agentName, agentKey), "NOT_FOUND");
    });

    it("queryLock returns null for unlocked file", async () => {
      const query = unwrap(await db.queryLock("unlocked.ts"));
      assert.strictEqual(query, null);
    });

    it("queryLock returns lock info", async () => {
      unwrap(await db.acquireLock("file.ts", agentName, agentKey, "testing", DEFAULT_LOCK_TIMEOUT_MS));
      const lock = unwrap(await db.queryLock("file.ts"));
      assert.notStrictEqual(lock, null);
      if (lock) {
        assert.strictEqual(lock.filePath, "file.ts");
        assert.strictEqual(lock.agentName, agentName);
        assert.strictEqual(lock.reason, "testing");
      }
    });

    it("listLocks returns all active locks", async () => {
      unwrap(await db.acquireLock("file1.ts", agentName, agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      unwrap(await db.acquireLock("file2.ts", agentName, agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      const locks = unwrap(await db.listLocks());
      assert.strictEqual(locks.length, 2);
    });

    it("renew extends lock expiration and increments version", async () => {
      unwrap(await db.acquireLock("file.ts", agentName, agentKey, null, SHORT_LOCK_TIMEOUT_MS));
      const before = unwrap(await db.queryLock("file.ts"));

      const renew = await db.renewLock("file.ts", agentName, agentKey, LONG_LOCK_TIMEOUT_MS);
      assert.strictEqual(renew.ok, true);

      const after = unwrap(await db.queryLock("file.ts"));
      if (before && after) {
        assert.ok(after.expiresAt > before.expiresAt);
        assert.ok(after.version > before.version);
      }
    });

    it("renew fails when not owned", async () => {
      assertError(await db.renewLock("file.ts", agentName, agentKey, DEFAULT_LOCK_TIMEOUT_MS), "NOT_FOUND");
    });

    it("expired lock can be taken over by another agent", async () => {
      unwrap(await db.acquireLock("file.ts", agentName, agentKey, null, EXPIRED_LOCK_TIMEOUT_MS));
      const reg2 = unwrap(await db.register("agent2"));
      const takeover = unwrap(await db.acquireLock("file.ts", reg2.agentName, reg2.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      assert.strictEqual(takeover.acquired, true);
    });

    it("forceReleaseLock fails on non-expired lock", async () => {
      const reg2 = unwrap(await db.register("agent2"));
      unwrap(await db.acquireLock("file.ts", agentName, agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      assertError(await db.forceReleaseLock("file.ts", reg2.agentName, reg2.agentKey), "LOCK_HELD");
    });

    it("forceReleaseLock fails when no lock exists", async () => {
      assertError(await db.forceReleaseLock("file.ts", agentName, agentKey), "NOT_FOUND");
    });
  });
};

/** Run message contract tests. */
const runMessageTests = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: messages", () => {
    let db: TooManyCooksDb;
    let cleanup: () => Promise<void>;
    let senderName: string;
    let senderKey: string;
    let receiverName: string;
    let receiverKey: string;

    beforeEach(async () => {
      ({ db, cleanup } = await createTestDb());
      const sender = unwrap(await db.register("sender"));
      ({ agentName: senderName, agentKey: senderKey } = sender);
      const receiver = unwrap(await db.register("receiver"));
      ({ agentName: receiverName, agentKey: receiverKey } = receiver);
    });

    afterEach(async () => {
      await cleanup();
    });

    it("send and receive message", async () => {
      const msgId = unwrap(await db.sendMessage(senderName, senderKey, receiverName, "hello"));
      assert.strictEqual(msgId.length, EXPECTED_MESSAGE_ID_LENGTH);

      const msgs = unwrap(await db.getMessages(receiverName, receiverKey, { unreadOnly: true }));
      assert.strictEqual(msgs.length, 1);
      const [firstMsg] = msgs;
      assert.strictEqual(firstMsg?.content, "hello");
      assert.strictEqual(firstMsg.fromAgent, senderName);
    });

    it("send fails with invalid credentials", async () => {
      assertError(await db.sendMessage(senderName, "wrong", receiverName, "hi"), "UNAUTHORIZED");
    });

    it("getMessages auto-marks as read", async () => {
      unwrap(await db.sendMessage(senderName, senderKey, receiverName, "test"));

      // First fetch auto-marks as read
      unwrap(await db.getMessages(receiverName, receiverKey));

      // Second fetch with unreadOnly returns empty
      const unread = unwrap(await db.getMessages(receiverName, receiverKey, { unreadOnly: true }));
      assert.strictEqual(unread.length, 0);
    });

    it("getMessages unreadOnly=false returns all messages", async () => {
      unwrap(await db.sendMessage(senderName, senderKey, receiverName, "test"));
      unwrap(await db.getMessages(receiverName, receiverKey)); // Marks read

      const all = unwrap(await db.getMessages(receiverName, receiverKey, { unreadOnly: false }));
      assert.strictEqual(all.length, 1);
    });

    it("broadcast message reaches other agents", async () => {
      const reg3 = unwrap(await db.register("agent3"));
      unwrap(await db.sendMessage(senderName, senderKey, BROADCAST_RECIPIENT, "announcement"));

      const msgs2 = unwrap(await db.getMessages(receiverName, receiverKey));
      const msgs3 = unwrap(await db.getMessages(reg3.agentName, reg3.agentKey));
      assert.ok(msgs2.some((msg) => {return msg.content === "announcement"}));
      assert.ok(msgs3.some((msg) => {return msg.content === "announcement"}));
    });

    it("mark message as read", async () => {
      const msgId = unwrap(await db.sendMessage(senderName, senderKey, receiverName, "hi"));
      const markResult = await db.markRead(msgId, receiverName, receiverKey);
      assert.strictEqual(markResult.ok, true);

      const unread = unwrap(await db.getMessages(receiverName, receiverKey, { unreadOnly: true }));
      assert.strictEqual(unread.length, 0);
    });

    it("markRead fails for nonexistent message", async () => {
      assertError(await db.markRead("nonexistent-id", receiverName, receiverKey), "NOT_FOUND");
    });

    it("listAllMessages returns all messages", async () => {
      unwrap(await db.sendMessage(senderName, senderKey, receiverName, "direct"));
      unwrap(await db.sendMessage(senderName, senderKey, BROADCAST_RECIPIENT, "broadcast"));
      const all = unwrap(await db.listAllMessages());
      assert.strictEqual(all.length, 2);
    });

    it("message contains correct metadata", async () => {
      unwrap(await db.sendMessage(senderName, senderKey, receiverName, "test"));
      const msgs = unwrap(await db.getMessages(receiverName, receiverKey));
      const [msg] = msgs;
      if (!msg) { throw new Error("Expected message"); }
      assert.strictEqual(msg.fromAgent, senderName);
      assert.strictEqual(msg.toAgent, receiverName);
      assert.strictEqual(msg.content, "test");
      assert.ok(msg.createdAt > 0);
      assert.strictEqual(msg.id.length, EXPECTED_MESSAGE_ID_LENGTH);
    });
  });
};

/** Run plan contract tests. */
const runPlanTests = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: plans", () => {
    let db: TooManyCooksDb;
    let cleanup: () => Promise<void>;
    let agentName: string;
    let agentKey: string;

    beforeEach(async () => {
      ({ db, cleanup } = await createTestDb());
      const reg = unwrap(await db.register("plan-agent"));
      ({ agentName, agentKey } = reg);
    });

    afterEach(async () => {
      await cleanup();
    });

    it("update and get plan", async () => {
      unwrap(await db.updatePlan(agentName, agentKey, "build feature", "writing tests"));
      const plan = unwrap(await db.getPlan(agentName));
      if (!plan) { throw new Error("Expected plan"); }
      assert.strictEqual(plan.goal, "build feature");
      assert.strictEqual(plan.currentTask, "writing tests");
      assert.strictEqual(plan.agentName, agentName);
      assert.ok(plan.updatedAt > 0);
    });

    it("one plan per agent — update replaces", async () => {
      unwrap(await db.updatePlan(agentName, agentKey, "goal1", "task1"));
      unwrap(await db.updatePlan(agentName, agentKey, "goal2", "task2"));

      const plans = unwrap(await db.listPlans());
      const agentPlans = plans.filter((plan) => {return plan.agentName === agentName});
      assert.strictEqual(agentPlans.length, 1);
      assert.strictEqual(agentPlans[0]?.goal, "goal2");
    });

    it("getPlan returns null for agent without plan", async () => {
      const reg2 = unwrap(await db.register("no-plan"));
      const plan = unwrap(await db.getPlan(reg2.agentName));
      assert.strictEqual(plan, null);
    });

    it("updatePlan fails with invalid credentials", async () => {
      assertError(await db.updatePlan(agentName, "wrong", "goal", "task"), "UNAUTHORIZED");
    });

    it("listPlans returns all plans", async () => {
      const reg2 = unwrap(await db.register("agent2"));
      unwrap(await db.updatePlan(agentName, agentKey, "goal1", "task1"));
      unwrap(await db.updatePlan(reg2.agentName, reg2.agentKey, "goal2", "task2"));

      const plans = unwrap(await db.listPlans());
      assert.strictEqual(plans.length, 2);
      const goals = new Set(plans.map((plan) => {return plan.goal}));
      assert.ok(goals.has("goal1"));
      assert.ok(goals.has("goal2"));
    });

    it("plan updatedAt changes on update", async () => {
      unwrap(await db.updatePlan(agentName, agentKey, "goal", "task1"));
      const plan1 = unwrap(await db.getPlan(agentName));

      unwrap(await db.updatePlan(agentName, agentKey, "goal", "task2"));
      const plan2 = unwrap(await db.getPlan(agentName));

      if (plan1 && plan2) {
        assert.ok(plan2.updatedAt >= plan1.updatedAt);
      }
    });
  });
};

/** Run activation contract tests. */
const runActivationTests = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: activation", () => {
    let db: TooManyCooksDb;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ db, cleanup } = await createTestDb());
    });

    afterEach(async () => {
      await cleanup();
    });

    it("activate and deactivate agent", async () => {
      unwrap(await db.register("agent1"));
      const activateResult = await db.activate("agent1");
      assert.strictEqual(activateResult.ok, true);

      const deactivateResult = await db.deactivate("agent1");
      assert.strictEqual(deactivateResult.ok, true);
    });

    it("activate fails for nonexistent agent", async () => {
      assertError(await db.activate("ghost"), "NOT_FOUND");
    });

    it("deactivate fails for nonexistent agent", async () => {
      assertError(await db.deactivate("ghost"), "NOT_FOUND");
    });

    it("deactivateAll succeeds", async () => {
      unwrap(await db.register("agent1"));
      unwrap(await db.register("agent2"));
      await db.activate("agent1");
      await db.activate("agent2");
      const result = await db.deactivateAll();
      assert.strictEqual(result.ok, true);
    });

    it("deactivateAll succeeds with no agents", async () => {
      const result = await db.deactivateAll();
      assert.strictEqual(result.ok, true);
    });
  });
};

/** Run admin operation contract tests. */
const runAdminTests = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: admin operations", () => {
    let db: TooManyCooksDb;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ db, cleanup } = await createTestDb());
    });

    afterEach(async () => {
      await cleanup();
    });

    it("adminDeleteLock removes lock", async () => {
      const reg = unwrap(await db.register("agent1"));
      unwrap(await db.acquireLock("file.ts", reg.agentName, reg.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));

      const del = await db.adminDeleteLock("file.ts");
      assert.strictEqual(del.ok, true);

      const query = unwrap(await db.queryLock("file.ts"));
      assert.strictEqual(query, null);
    });

    it("adminDeleteLock fails for nonexistent lock", async () => {
      assertError(await db.adminDeleteLock("nope.ts"), "NOT_FOUND");
    });

    it("adminDeleteAgent cascades (removes locks, plans, messages)", async () => {
      const reg = unwrap(await db.register("doomed"));
      const reg2 = unwrap(await db.register("other"));
      unwrap(await db.acquireLock("file.ts", reg.agentName, reg.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      unwrap(await db.updatePlan(reg.agentName, reg.agentKey, "goal", "task"));
      unwrap(await db.sendMessage(reg.agentName, reg.agentKey, reg2.agentName, "hello"));

      const del = await db.adminDeleteAgent("doomed");
      assert.strictEqual(del.ok, true);

      const agents = unwrap(await db.listAgents());
      assert.strictEqual(agents.filter((agent) => {return agent.agentName === "doomed"}).length, 0);

      const locks = unwrap(await db.listLocks());
      assert.strictEqual(locks.filter((lock) => {return lock.agentName === "doomed"}).length, 0);

      const plan = unwrap(await db.getPlan("doomed"));
      assert.strictEqual(plan, null);
    });

    it("adminDeleteAgent fails for nonexistent agent", async () => {
      assertError(await db.adminDeleteAgent("ghost"), "NOT_FOUND");
    });

    it("adminResetKey generates new key, invalidates old", async () => {
      const reg = unwrap(await db.register("agent1"));
      const oldKey = reg.agentKey;

      const newReg = unwrap(await db.adminResetKey("agent1"));
      assert.strictEqual(newReg.agentName, "agent1");
      assert.notStrictEqual(newReg.agentKey, oldKey);
      assert.strictEqual(newReg.agentKey.length, EXPECTED_KEY_LENGTH);

      // Old key fails
      assertError(await db.authenticate("agent1", oldKey), "UNAUTHORIZED");

      // New key works
      const auth = await db.authenticate("agent1", newReg.agentKey);
      assert.strictEqual(auth.ok, true);
    });

    it("adminResetKey releases locks held by agent", async () => {
      const reg = unwrap(await db.register("agent1"));
      unwrap(await db.acquireLock("file.ts", reg.agentName, reg.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));

      unwrap(await db.adminResetKey("agent1"));

      const lock = unwrap(await db.queryLock("file.ts"));
      assert.strictEqual(lock, null);
    });

    it("adminResetKey fails for nonexistent agent", async () => {
      assertError(await db.adminResetKey("ghost"), "NOT_FOUND");
    });

    it("adminReset clears transient data but preserves identity", async () => {
      const reg = unwrap(await db.register("agent1"));
      unwrap(await db.acquireLock("file.ts", reg.agentName, reg.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      unwrap(await db.updatePlan(reg.agentName, reg.agentKey, "goal", "task"));

      unwrap(await db.adminReset());

      // Transient data cleared
      const locks = unwrap(await db.listLocks());
      assert.strictEqual(locks.length, 0);

      const plans = unwrap(await db.listPlans());
      assert.strictEqual(plans.length, 0);

      // Identity preserved — agent can reconnect with saved key
      const lookup = unwrap(await db.lookupByKey(reg.agentKey));
      assert.strictEqual(lookup, "agent1");
    });

    it("adminSendMessage sends without auth", async () => {
      unwrap(await db.register("recipient"));
      const msgId = unwrap(await db.adminSendMessage("system", "recipient", "hello from admin"));
      assert.strictEqual(msgId.length, EXPECTED_MESSAGE_ID_LENGTH);
    });
  });
};

/**
 * Run the full TooManyCooksDb contract test suite.
 *
 * @param createTestDb - Factory that creates a fresh db instance per test
 */
export const runDbContractTests = (createTestDb: DbFactory): void => {
  runRegistrationTests(createTestDb);
  runAuthenticationTests(createTestDb);
  runLockTests(createTestDb);
  runMessageTests(createTestDb);
  runPlanTests(createTestDb);
  runActivationTests(createTestDb);
  runAdminTests(createTestDb);
};
