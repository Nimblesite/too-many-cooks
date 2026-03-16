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
///   import { runDbContractTests } from "too-many-cooks-core";
///   runDbContractTests(async () => ({
///     db: yourDbInstance,
///     cleanup: async () => { /* tear down */ },
///   }));

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import type { TooManyCooksDb } from "./db-interface.js";
import type { AgentIdentity, AgentPlan, AgentRegistration, FileLock, LockResult, Message } from "./types.gen.js";

/** Result of creating a test db instance. */
type DbInstance = {
  readonly db: TooManyCooksDb;
  readonly cleanup: () => Promise<void>;
};

/** Factory type for creating test db instances. */
type DbFactory = () => Promise<DbInstance>;

/** Result type for unwrap. */
type OkResult<T> = {
  readonly ok: true;
  readonly value: T;
};

/** Expected key length in hex chars (32 bytes = 64 hex). */
const EXPECTED_KEY_LENGTH: number = 64;

/** Expected message ID length. */
const EXPECTED_MESSAGE_ID_LENGTH: number = 16;

/** Default lock timeout in ms. */
const DEFAULT_LOCK_TIMEOUT_MS: number = 600_000;

/** Immediately-expired lock timeout. */
const EXPIRED_LOCK_TIMEOUT_MS: number = 0;

/** Short lock timeout for renewal tests. */
const SHORT_LOCK_TIMEOUT_MS: number = 1_000;

/** Long lock timeout for renewal tests. */
const LONG_LOCK_TIMEOUT_MS: number = 60_000;

/** Max agent name length. */
const MAX_AGENT_NAME_LENGTH: number = 50;

/** Over max agent name length. */
const OVER_MAX_AGENT_NAME_LENGTH: number = 51;

/** Broadcast recipient. */
const BROADCAST_RECIPIENT: string = "*";

/** Type guard: value is an OkResult. */
const isOkResult: <T>(result: { readonly ok: boolean; readonly value?: T; readonly error?: unknown }) => result is OkResult<T> = <T>(
  result: { readonly ok: boolean; readonly value?: T; readonly error?: unknown },
): result is OkResult<T> => result.ok;

/** Unwrap a successful Result or throw. */
const unwrap: <T>(result: { readonly ok: boolean; readonly value?: T; readonly error?: unknown }) => T = <T>(
  result: { readonly ok: boolean; readonly value?: T; readonly error?: unknown },
): T => {
  if (!isOkResult(result)) {
    throw new Error(`Expected ok result, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

/** Assert a Result is an error with the expected code. */
const assertError: (
  result: { readonly ok: boolean; readonly error?: { readonly code: string } },
  expectedCode: string,
) => void = (
  result: { readonly ok: boolean; readonly error?: { readonly code: string } },
  expectedCode: string,
): void => {
  assert.strictEqual(result.ok, false, `Expected error with code ${expectedCode}, got ok`);
  assert.strictEqual(result.error?.code, expectedCode);
};

/** Run registration contract tests. */
const runRegistrationTests: (createTestDb: DbFactory) => void = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: registration", () => {
    let inst: DbInstance;

    beforeEach(async (): Promise<void> => {
      inst = await createTestDb();
    });

    afterEach(async (): Promise<void> => {
      await inst.cleanup();
    });

    it("register creates agent with unique hex key", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await inst.db.register("agent1"));
      assert.strictEqual(reg.agentName, "agent1");
      assert.strictEqual(reg.agentKey.length, EXPECTED_KEY_LENGTH);
    });

    it("register fails for duplicate active name", async (): Promise<void> => {
      unwrap(await inst.db.register("agent1"));
      const result: Awaited<ReturnType<TooManyCooksDb["register"]>> = await inst.db.register("agent1");
      assert.strictEqual(result.ok, false);
    });

    it("register fails for empty name", async (): Promise<void> => {
      const result: Awaited<ReturnType<TooManyCooksDb["register"]>> = await inst.db.register("");
      assertError(result, "VALIDATION");
    });

    it("register fails for name over 50 chars", async (): Promise<void> => {
      const result: Awaited<ReturnType<TooManyCooksDb["register"]>> = await inst.db.register("a".repeat(OVER_MAX_AGENT_NAME_LENGTH));
      assertError(result, "VALIDATION");
    });

    it("register accepts name of exactly 50 chars", async (): Promise<void> => {
      const result: Awaited<ReturnType<TooManyCooksDb["register"]>> = await inst.db.register("a".repeat(MAX_AGENT_NAME_LENGTH));
      assert.strictEqual(result.ok, true);
    });

    it("two registrations produce different keys", async (): Promise<void> => {
      const reg1: AgentRegistration = unwrap(await inst.db.register("agent1"));
      const reg2: AgentRegistration = unwrap(await inst.db.register("agent2"));
      assert.notStrictEqual(reg1.agentKey, reg2.agentKey);
    });

    it("listAgents returns registered agents", async (): Promise<void> => {
      unwrap(await inst.db.register("agent1"));
      unwrap(await inst.db.register("agent2"));
      const agents: readonly AgentIdentity[] = unwrap(await inst.db.listAgents());
      const names: Set<string> = new Set<string>(agents.map((agent: AgentIdentity): string => {return agent.agentName}));
      assert.ok(names.has("agent1"));
      assert.ok(names.has("agent2"));
    });
  });
};

/** Run authentication contract tests. */
const runAuthenticationTests: (createTestDb: DbFactory) => void = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: authentication", () => {
    let inst: DbInstance;

    beforeEach(async (): Promise<void> => {
      inst = await createTestDb();
    });

    afterEach(async (): Promise<void> => {
      await inst.cleanup();
    });

    it("authenticate succeeds with correct key", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await inst.db.register("agent1"));
      const auth: AgentIdentity = unwrap(await inst.db.authenticate("agent1", reg.agentKey));
      assert.strictEqual(auth.agentName, "agent1");
    });

    it("authenticate fails with wrong key", async (): Promise<void> => {
      unwrap(await inst.db.register("agent1"));
      assertError(await inst.db.authenticate("agent1", "wrong-key"), "UNAUTHORIZED");
    });

    it("authenticate fails for nonexistent agent", async (): Promise<void> => {
      assertError(await inst.db.authenticate("ghost", "any-key"), "UNAUTHORIZED");
    });

    it("authenticate updates last_active timestamp", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await inst.db.register("agent1"));
      const first: AgentIdentity = unwrap(await inst.db.authenticate("agent1", reg.agentKey));
      const second: AgentIdentity = unwrap(await inst.db.authenticate("agent1", reg.agentKey));
      assert.ok(second.lastActive >= first.lastActive);
    });

    it("lookupByKey returns agent name", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await inst.db.register("agent1"));
      const name: string = unwrap(await inst.db.lookupByKey(reg.agentKey));
      assert.strictEqual(name, "agent1");
    });

    it("lookupByKey fails for invalid key", async (): Promise<void> => {
      assertError(await inst.db.lookupByKey("invalid-key"), "UNAUTHORIZED");
    });
  });
};

/** Lock test state. */
type LockTestState = {
  readonly inst: DbInstance;
  readonly agentName: string;
  readonly agentKey: string;
};

/** Run lock contract tests. */
const runLockTests: (createTestDb: DbFactory) => void = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: locks", () => {
    let state: LockTestState;

    beforeEach(async (): Promise<void> => {
      const inst: DbInstance = await createTestDb();
      const reg: AgentRegistration = unwrap(await inst.db.register("lock-agent"));
      state = { inst, agentName: reg.agentName, agentKey: reg.agentKey };
    });

    afterEach(async (): Promise<void> => {
      await state.inst.cleanup();
    });

    it("acquire and release lock", async (): Promise<void> => {
      const lockResult: LockResult = unwrap(await state.inst.db.acquireLock("file.ts", state.agentName, state.agentKey, "editing", DEFAULT_LOCK_TIMEOUT_MS));
      assert.strictEqual(lockResult.acquired, true);

      const release: Awaited<ReturnType<TooManyCooksDb["releaseLock"]>> = await state.inst.db.releaseLock("file.ts", state.agentName, state.agentKey);
      assert.strictEqual(release.ok, true);

      const query: FileLock | null = unwrap(await state.inst.db.queryLock("file.ts"));
      assert.strictEqual(query, null);
    });

    it("lock conflict between agents (acquired=false, not error)", async (): Promise<void> => {
      const reg2: AgentRegistration = unwrap(await state.inst.db.register("agent2"));
      unwrap(await state.inst.db.acquireLock("file.ts", state.agentName, state.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));

      const conflict: LockResult = unwrap(await state.inst.db.acquireLock("file.ts", reg2.agentName, reg2.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      assert.strictEqual(conflict.acquired, false);
    });

    it("acquire fails with invalid credentials", async (): Promise<void> => {
      assertError(await state.inst.db.acquireLock("file.ts", state.agentName, "wrong", null, DEFAULT_LOCK_TIMEOUT_MS), "UNAUTHORIZED");
    });

    it("release fails when not owned", async (): Promise<void> => {
      assertError(await state.inst.db.releaseLock("file.ts", state.agentName, state.agentKey), "NOT_FOUND");
    });

    it("queryLock returns null for unlocked file", async (): Promise<void> => {
      const query: FileLock | null = unwrap(await state.inst.db.queryLock("unlocked.ts"));
      assert.strictEqual(query, null);
    });

    it("queryLock returns lock info", async (): Promise<void> => {
      unwrap(await state.inst.db.acquireLock("file.ts", state.agentName, state.agentKey, "testing", DEFAULT_LOCK_TIMEOUT_MS));
      const lock: FileLock | null = unwrap(await state.inst.db.queryLock("file.ts"));
      assert.notStrictEqual(lock, null);
      if (lock) {
        assert.strictEqual(lock.filePath, "file.ts");
        assert.strictEqual(lock.agentName, state.agentName);
        assert.strictEqual(lock.reason, "testing");
      }
    });

    it("listLocks returns all active locks", async (): Promise<void> => {
      unwrap(await state.inst.db.acquireLock("file1.ts", state.agentName, state.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      unwrap(await state.inst.db.acquireLock("file2.ts", state.agentName, state.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      const locks: readonly FileLock[] = unwrap(await state.inst.db.listLocks());
      assert.strictEqual(locks.length, 2);
    });

    it("renew extends lock expiration and increments version", async (): Promise<void> => {
      unwrap(await state.inst.db.acquireLock("file.ts", state.agentName, state.agentKey, null, SHORT_LOCK_TIMEOUT_MS));
      const before: FileLock | null = unwrap(await state.inst.db.queryLock("file.ts"));

      const renew: Awaited<ReturnType<TooManyCooksDb["renewLock"]>> = await state.inst.db.renewLock("file.ts", state.agentName, state.agentKey, LONG_LOCK_TIMEOUT_MS);
      assert.strictEqual(renew.ok, true);

      const after: FileLock | null = unwrap(await state.inst.db.queryLock("file.ts"));
      if (before && after) {
        assert.ok(after.expiresAt > before.expiresAt);
        assert.ok(after.version > before.version);
      }
    });

    it("renew fails when not owned", async (): Promise<void> => {
      assertError(await state.inst.db.renewLock("file.ts", state.agentName, state.agentKey, DEFAULT_LOCK_TIMEOUT_MS), "NOT_FOUND");
    });

    it("expired lock can be taken over by another agent", async (): Promise<void> => {
      unwrap(await state.inst.db.acquireLock("file.ts", state.agentName, state.agentKey, null, EXPIRED_LOCK_TIMEOUT_MS));
      const reg2: AgentRegistration = unwrap(await state.inst.db.register("agent2"));
      const takeover: LockResult = unwrap(await state.inst.db.acquireLock("file.ts", reg2.agentName, reg2.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      assert.strictEqual(takeover.acquired, true);
    });

    it("forceReleaseLock fails on non-expired lock", async (): Promise<void> => {
      const reg2: AgentRegistration = unwrap(await state.inst.db.register("agent2"));
      unwrap(await state.inst.db.acquireLock("file.ts", state.agentName, state.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      assertError(await state.inst.db.forceReleaseLock("file.ts", reg2.agentName, reg2.agentKey), "LOCK_HELD");
    });

    it("forceReleaseLock fails when no lock exists", async (): Promise<void> => {
      assertError(await state.inst.db.forceReleaseLock("file.ts", state.agentName, state.agentKey), "NOT_FOUND");
    });
  });
};

/** Message test state. */
type MessageTestState = {
  readonly inst: DbInstance;
  readonly senderName: string;
  readonly senderKey: string;
  readonly receiverName: string;
  readonly receiverKey: string;
};

/** Run message contract tests. */
const runMessageTests: (createTestDb: DbFactory) => void = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: messages", () => {
    let state: MessageTestState;

    beforeEach(async (): Promise<void> => {
      const inst: DbInstance = await createTestDb();
      const sender: AgentRegistration = unwrap(await inst.db.register("sender"));
      const receiver: AgentRegistration = unwrap(await inst.db.register("receiver"));
      state = {
        inst,
        senderName: sender.agentName,
        senderKey: sender.agentKey,
        receiverName: receiver.agentName,
        receiverKey: receiver.agentKey,
      };
    });

    afterEach(async (): Promise<void> => {
      await state.inst.cleanup();
    });

    it("send and receive message", async (): Promise<void> => {
      const msgId: string = unwrap(await state.inst.db.sendMessage(state.senderName, state.senderKey, state.receiverName, "hello"));
      assert.strictEqual(msgId.length, EXPECTED_MESSAGE_ID_LENGTH);

      const msgs: readonly Message[] = unwrap(await state.inst.db.getMessages(state.receiverName, state.receiverKey, { unreadOnly: true }));
      assert.strictEqual(msgs.length, 1);
      const [firstMsg]: readonly Message[] = msgs;
      if (firstMsg === undefined) { throw new Error("Expected first message"); }
      assert.strictEqual(firstMsg.content, "hello");
      assert.strictEqual(firstMsg.fromAgent, state.senderName);
    });

    it("send fails with invalid credentials", async (): Promise<void> => {
      assertError(await state.inst.db.sendMessage(state.senderName, "wrong", state.receiverName, "hi"), "UNAUTHORIZED");
    });

    it("getMessages auto-marks as read", async (): Promise<void> => {
      unwrap(await state.inst.db.sendMessage(state.senderName, state.senderKey, state.receiverName, "test"));

      // First fetch auto-marks as read
      unwrap(await state.inst.db.getMessages(state.receiverName, state.receiverKey));

      // Second fetch with unreadOnly returns empty
      const unread: readonly Message[] = unwrap(await state.inst.db.getMessages(state.receiverName, state.receiverKey, { unreadOnly: true }));
      assert.strictEqual(unread.length, 0);
    });

    it("getMessages unreadOnly=false returns all messages", async (): Promise<void> => {
      unwrap(await state.inst.db.sendMessage(state.senderName, state.senderKey, state.receiverName, "test"));
      unwrap(await state.inst.db.getMessages(state.receiverName, state.receiverKey)); // Marks read

      const all: readonly Message[] = unwrap(await state.inst.db.getMessages(state.receiverName, state.receiverKey, { unreadOnly: false }));
      assert.strictEqual(all.length, 1);
    });

    it("broadcast message reaches other agents", async (): Promise<void> => {
      const reg3: AgentRegistration = unwrap(await state.inst.db.register("agent3"));
      unwrap(await state.inst.db.sendMessage(state.senderName, state.senderKey, BROADCAST_RECIPIENT, "announcement"));

      const msgs2: readonly Message[] = unwrap(await state.inst.db.getMessages(state.receiverName, state.receiverKey));
      const msgs3: readonly Message[] = unwrap(await state.inst.db.getMessages(reg3.agentName, reg3.agentKey));
      assert.ok(msgs2.some((msg: Message): boolean => {return msg.content === "announcement"}));
      assert.ok(msgs3.some((msg: Message): boolean => {return msg.content === "announcement"}));
    });

    it("mark message as read", async (): Promise<void> => {
      const msgId: string = unwrap(await state.inst.db.sendMessage(state.senderName, state.senderKey, state.receiverName, "hi"));
      const markResult: Awaited<ReturnType<TooManyCooksDb["markRead"]>> = await state.inst.db.markRead(msgId, state.receiverName, state.receiverKey);
      assert.strictEqual(markResult.ok, true);

      const unread: readonly Message[] = unwrap(await state.inst.db.getMessages(state.receiverName, state.receiverKey, { unreadOnly: true }));
      assert.strictEqual(unread.length, 0);
    });

    it("markRead fails for nonexistent message", async (): Promise<void> => {
      assertError(await state.inst.db.markRead("nonexistent-id", state.receiverName, state.receiverKey), "NOT_FOUND");
    });

    it("listAllMessages returns all messages", async (): Promise<void> => {
      unwrap(await state.inst.db.sendMessage(state.senderName, state.senderKey, state.receiverName, "direct"));
      unwrap(await state.inst.db.sendMessage(state.senderName, state.senderKey, BROADCAST_RECIPIENT, "broadcast"));
      const all: readonly Message[] = unwrap(await state.inst.db.listAllMessages());
      assert.strictEqual(all.length, 2);
    });

    it("message contains correct metadata", async (): Promise<void> => {
      unwrap(await state.inst.db.sendMessage(state.senderName, state.senderKey, state.receiverName, "test"));
      const msgs: readonly Message[] = unwrap(await state.inst.db.getMessages(state.receiverName, state.receiverKey));
      const [msg]: readonly Message[] = msgs;
      if (!msg) { throw new Error("Expected message"); }
      assert.strictEqual(msg.fromAgent, state.senderName);
      assert.strictEqual(msg.toAgent, state.receiverName);
      assert.strictEqual(msg.content, "test");
      assert.ok(msg.createdAt > 0);
      assert.strictEqual(msg.id.length, EXPECTED_MESSAGE_ID_LENGTH);
    });
  });
};

/** Plan test state. */
type PlanTestState = {
  readonly inst: DbInstance;
  readonly agentName: string;
  readonly agentKey: string;
};

/** Run plan contract tests. */
const runPlanTests: (createTestDb: DbFactory) => void = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: plans", () => {
    let state: PlanTestState;

    beforeEach(async (): Promise<void> => {
      const inst: DbInstance = await createTestDb();
      const reg: AgentRegistration = unwrap(await inst.db.register("plan-agent"));
      state = { inst, agentName: reg.agentName, agentKey: reg.agentKey };
    });

    afterEach(async (): Promise<void> => {
      await state.inst.cleanup();
    });

    it("update and get plan", async (): Promise<void> => {
      unwrap(await state.inst.db.updatePlan(state.agentName, state.agentKey, "build feature", "writing tests"));
      const plan: AgentPlan | null = unwrap(await state.inst.db.getPlan(state.agentName));
      if (!plan) { throw new Error("Expected plan"); }
      assert.strictEqual(plan.goal, "build feature");
      assert.strictEqual(plan.currentTask, "writing tests");
      assert.strictEqual(plan.agentName, state.agentName);
      assert.ok(plan.updatedAt > 0);
    });

    it("one plan per agent - update replaces", async (): Promise<void> => {
      unwrap(await state.inst.db.updatePlan(state.agentName, state.agentKey, "goal1", "task1"));
      unwrap(await state.inst.db.updatePlan(state.agentName, state.agentKey, "goal2", "task2"));

      const plans: readonly AgentPlan[] = unwrap(await state.inst.db.listPlans());
      const agentPlans: readonly AgentPlan[] = plans.filter((plan: AgentPlan): boolean => {return plan.agentName === state.agentName});
      assert.strictEqual(agentPlans.length, 1);
      assert.strictEqual(agentPlans[0]?.goal, "goal2");
    });

    it("getPlan returns null for agent without plan", async (): Promise<void> => {
      const reg2: AgentRegistration = unwrap(await state.inst.db.register("no-plan"));
      const plan: AgentPlan | null = unwrap(await state.inst.db.getPlan(reg2.agentName));
      assert.strictEqual(plan, null);
    });

    it("updatePlan fails with invalid credentials", async (): Promise<void> => {
      assertError(await state.inst.db.updatePlan(state.agentName, "wrong", "goal", "task"), "UNAUTHORIZED");
    });

    it("listPlans returns all plans", async (): Promise<void> => {
      const reg2: AgentRegistration = unwrap(await state.inst.db.register("agent2"));
      unwrap(await state.inst.db.updatePlan(state.agentName, state.agentKey, "goal1", "task1"));
      unwrap(await state.inst.db.updatePlan(reg2.agentName, reg2.agentKey, "goal2", "task2"));

      const plans: readonly AgentPlan[] = unwrap(await state.inst.db.listPlans());
      assert.strictEqual(plans.length, 2);
      const goals: Set<string> = new Set<string>(plans.map((plan: AgentPlan): string => {return plan.goal}));
      assert.ok(goals.has("goal1"));
      assert.ok(goals.has("goal2"));
    });

    it("plan updatedAt changes on update", async (): Promise<void> => {
      unwrap(await state.inst.db.updatePlan(state.agentName, state.agentKey, "goal", "task1"));
      const plan1: AgentPlan | null = unwrap(await state.inst.db.getPlan(state.agentName));

      unwrap(await state.inst.db.updatePlan(state.agentName, state.agentKey, "goal", "task2"));
      const plan2: AgentPlan | null = unwrap(await state.inst.db.getPlan(state.agentName));

      if (plan1 && plan2) {
        assert.ok(plan2.updatedAt >= plan1.updatedAt);
      }
    });
  });
};

/** Run activation contract tests. */
const runActivationTests: (createTestDb: DbFactory) => void = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: activation", () => {
    let inst: DbInstance;

    beforeEach(async (): Promise<void> => {
      inst = await createTestDb();
    });

    afterEach(async (): Promise<void> => {
      await inst.cleanup();
    });

    it("activate and deactivate agent", async (): Promise<void> => {
      unwrap(await inst.db.register("agent1"));
      const activateResult: Awaited<ReturnType<TooManyCooksDb["activate"]>> = await inst.db.activate("agent1");
      assert.strictEqual(activateResult.ok, true);

      const deactivateResult: Awaited<ReturnType<TooManyCooksDb["deactivate"]>> = await inst.db.deactivate("agent1");
      assert.strictEqual(deactivateResult.ok, true);
    });

    it("activate fails for nonexistent agent", async (): Promise<void> => {
      assertError(await inst.db.activate("ghost"), "NOT_FOUND");
    });

    it("deactivate fails for nonexistent agent", async (): Promise<void> => {
      assertError(await inst.db.deactivate("ghost"), "NOT_FOUND");
    });

    it("deactivateAll succeeds", async (): Promise<void> => {
      unwrap(await inst.db.register("agent1"));
      unwrap(await inst.db.register("agent2"));
      await inst.db.activate("agent1");
      await inst.db.activate("agent2");
      const result: Awaited<ReturnType<TooManyCooksDb["deactivateAll"]>> = await inst.db.deactivateAll();
      assert.strictEqual(result.ok, true);
    });

    it("deactivateAll succeeds with no agents", async (): Promise<void> => {
      const result: Awaited<ReturnType<TooManyCooksDb["deactivateAll"]>> = await inst.db.deactivateAll();
      assert.strictEqual(result.ok, true);
    });
  });
};

/** Run admin operation contract tests. */
const runAdminTests: (createTestDb: DbFactory) => void = (createTestDb: DbFactory): void => {
  describe("TooManyCooksDb contract: admin operations", () => {
    let inst: DbInstance;

    beforeEach(async (): Promise<void> => {
      inst = await createTestDb();
    });

    afterEach(async (): Promise<void> => {
      await inst.cleanup();
    });

    it("adminDeleteLock removes lock", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await inst.db.register("agent1"));
      unwrap(await inst.db.acquireLock("file.ts", reg.agentName, reg.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));

      const del: Awaited<ReturnType<TooManyCooksDb["adminDeleteLock"]>> = await inst.db.adminDeleteLock("file.ts");
      assert.strictEqual(del.ok, true);

      const query: FileLock | null = unwrap(await inst.db.queryLock("file.ts"));
      assert.strictEqual(query, null);
    });

    it("adminDeleteLock fails for nonexistent lock", async (): Promise<void> => {
      assertError(await inst.db.adminDeleteLock("nope.ts"), "NOT_FOUND");
    });

    it("adminDeleteAgent cascades (removes locks, plans, messages)", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await inst.db.register("doomed"));
      const reg2: AgentRegistration = unwrap(await inst.db.register("other"));
      unwrap(await inst.db.acquireLock("file.ts", reg.agentName, reg.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      unwrap(await inst.db.updatePlan(reg.agentName, reg.agentKey, "goal", "task"));
      unwrap(await inst.db.sendMessage(reg.agentName, reg.agentKey, reg2.agentName, "hello"));

      const del: Awaited<ReturnType<TooManyCooksDb["adminDeleteAgent"]>> = await inst.db.adminDeleteAgent("doomed");
      assert.strictEqual(del.ok, true);

      const agents: readonly AgentIdentity[] = unwrap(await inst.db.listAgents());
      assert.strictEqual(agents.filter((agent: AgentIdentity): boolean => {return agent.agentName === "doomed"}).length, 0);

      const locks: readonly FileLock[] = unwrap(await inst.db.listLocks());
      assert.strictEqual(locks.filter((lock: FileLock): boolean => {return lock.agentName === "doomed"}).length, 0);

      const plan: AgentPlan | null = unwrap(await inst.db.getPlan("doomed"));
      assert.strictEqual(plan, null);
    });

    it("adminDeleteAgent fails for nonexistent agent", async (): Promise<void> => {
      assertError(await inst.db.adminDeleteAgent("ghost"), "NOT_FOUND");
    });

    it("adminResetKey generates new key, invalidates old", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await inst.db.register("agent1"));
      const oldKey: string = reg.agentKey;

      const newReg: AgentRegistration = unwrap(await inst.db.adminResetKey("agent1"));
      assert.strictEqual(newReg.agentName, "agent1");
      assert.notStrictEqual(newReg.agentKey, oldKey);
      assert.strictEqual(newReg.agentKey.length, EXPECTED_KEY_LENGTH);

      // Old key fails
      assertError(await inst.db.authenticate("agent1", oldKey), "UNAUTHORIZED");

      // New key works
      const auth: Awaited<ReturnType<TooManyCooksDb["authenticate"]>> = await inst.db.authenticate("agent1", newReg.agentKey);
      assert.strictEqual(auth.ok, true);
    });

    it("adminResetKey releases locks held by agent", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await inst.db.register("agent1"));
      unwrap(await inst.db.acquireLock("file.ts", reg.agentName, reg.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));

      unwrap(await inst.db.adminResetKey("agent1"));

      const lock: FileLock | null = unwrap(await inst.db.queryLock("file.ts"));
      assert.strictEqual(lock, null);
    });

    it("adminResetKey fails for nonexistent agent", async (): Promise<void> => {
      assertError(await inst.db.adminResetKey("ghost"), "NOT_FOUND");
    });

    it("adminReset clears transient data but preserves identity", async (): Promise<void> => {
      const reg: AgentRegistration = unwrap(await inst.db.register("agent1"));
      unwrap(await inst.db.acquireLock("file.ts", reg.agentName, reg.agentKey, null, DEFAULT_LOCK_TIMEOUT_MS));
      unwrap(await inst.db.updatePlan(reg.agentName, reg.agentKey, "goal", "task"));

      unwrap(await inst.db.adminReset());

      // Transient data cleared
      const locks: readonly FileLock[] = unwrap(await inst.db.listLocks());
      assert.strictEqual(locks.length, 0);

      const plans: readonly AgentPlan[] = unwrap(await inst.db.listPlans());
      assert.strictEqual(plans.length, 0);

      // Identity preserved - agent can reconnect with saved key
      const lookup: string = unwrap(await inst.db.lookupByKey(reg.agentKey));
      assert.strictEqual(lookup, "agent1");
    });

    it("adminSendMessage sends without auth", async (): Promise<void> => {
      unwrap(await inst.db.register("recipient"));
      const msgId: string = unwrap(await inst.db.adminSendMessage("system", "recipient", "hello from admin"));
      assert.strictEqual(msgId.length, EXPECTED_MESSAGE_ID_LENGTH);
    });
  });
};

/**
 * Run the full TooManyCooksDb contract test suite.
 *
 * @param createTestDb - Factory that creates a fresh db instance per test
 */
export const runDbContractTests: (createTestDb: DbFactory) => void = (createTestDb: DbFactory): void => {
  runRegistrationTests(createTestDb);
  runAuthenticationTests(createTestDb);
  runLockTests(createTestDb);
  runMessageTests(createTestDb);
  runPlanTests(createTestDb);
  runActivationTests(createTestDb);
  runAdminTests(createTestDb);
};
