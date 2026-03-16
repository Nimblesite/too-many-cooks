/// E2E encryption round-trip tests.
///
/// Proves the full cycle: plaintext → encrypt → store → retrieve → decrypt → plaintext.
/// Uses a realistic in-memory db that stores ciphertext, then retrieves and decrypts
/// through the encryption middleware — proving zero-knowledge architecture works.

import { strict as assert } from "node:assert";
import test from "node:test";

import type {
  AgentPlan,
  FileLock,
  Message,
  TooManyCooksDb,
} from "too-many-cooks-core";
import { success } from "too-many-cooks-core";

import { deriveWorkspaceKey } from "../src/crypto.js";
import { withEncryption } from "../src/encryption-middleware.js";

/** Test passphrase for key derivation. */
const E2E_PASSPHRASE = "e2e-test-passphrase-42";

/** Test workspace ID. */
const E2E_WORKSPACE = "e2e-ws-00000000-0000-0000-0000-000000000099";

/** Agent name for sender. */
const AGENT_ALICE = "alice";

/** Agent name for receiver. */
const AGENT_BOB = "bob";

/** Agent key for alice. */
const ALICE_KEY = "alice-key-abc123";

/** Agent key for bob. */
const BOB_KEY = "bob-key-def456";

/** Message content (plaintext). */
const MSG_CONTENT = "Please review auth.ts changes before merging";

/** Plan goal (plaintext). */
const PLAN_GOAL = "Implement OAuth2 PKCE flow for mobile clients";

/** Plan current task (plaintext). */
const PLAN_TASK = "Writing integration tests for token refresh";

/** Lock reason (plaintext). */
const LOCK_REASON = "refactoring auth middleware to support PKCE";

/** File path for lock tests. */
const LOCK_FILE = "/src/auth/middleware.ts";

/** Fixed timestamp for deterministic tests. */
const FIXED_TS = 1700000000000;

/** Auto-incrementing message ID counter start. */
const MSG_ID_START = 1;

/** Default lock version. */
const LOCK_VERSION = 1;

/** Default lock timeout. */
const LOCK_TIMEOUT = 60000;

/**
 * In-memory db that stores values AS-IS (ciphertext when used behind middleware).
 * Simulates a real cloud database that never sees plaintext.
 */
const createStorageDb = (): TooManyCooksDb => {
  const messages: Message[] = [];
  const plans = new Map<string, AgentPlan>();
  const locks = new Map<string, FileLock>();
  let msgCounter = MSG_ID_START;

  const notImpl = (): never => {
    throw new Error("not used in e2e test");
  };

  return {
    register: notImpl,
    authenticate: notImpl,
    lookupByKey: notImpl,
    listAgents: notImpl,
    acquireLock: async (fp, an, _ak, reason, _t) => {
      const lock: FileLock = {
        filePath: fp,
        agentName: an,
        acquiredAt: FIXED_TS,
        expiresAt: FIXED_TS + LOCK_TIMEOUT,
        reason: reason ?? null,
        version: LOCK_VERSION,
      };
      locks.set(fp, lock);
      return success({ acquired: true, lock, error: undefined });
    },
    releaseLock: async (fp) => {
      locks.delete(fp);
      return success(undefined);
    },
    forceReleaseLock: notImpl,
    queryLock: async (fp) => {
      const lock = locks.get(fp);
      return success(lock ?? null);
    },
    listLocks: async () => success([...locks.values()]),
    renewLock: notImpl,
    sendMessage: async (from, _key, to, content) => {
      const id = `msg-${String(msgCounter)}`;
      msgCounter += 1;
      messages.push({
        id,
        fromAgent: from,
        toAgent: to,
        content,
        createdAt: FIXED_TS,
        readAt: undefined,
      });
      return success(id);
    },
    getMessages: async (an) => {
      const filtered = messages.filter((m) => m.toAgent === an);
      return success(filtered);
    },
    markRead: notImpl,
    updatePlan: async (an, _ak, goal, task) => {
      plans.set(an, {
        agentName: an,
        goal,
        currentTask: task,
        updatedAt: FIXED_TS,
      });
      return success(undefined);
    },
    getPlan: async (an) => {
      const plan = plans.get(an);
      return success(plan ?? null);
    },
    listPlans: async () => success([...plans.values()]),
    listAllMessages: async () => success([...messages]),
    activate: notImpl,
    deactivate: notImpl,
    deactivateAll: notImpl,
    close: async () => success(undefined),
    adminDeleteLock: notImpl,
    adminDeleteAgent: notImpl,
    adminResetKey: notImpl,
    adminSendMessage: async (from, to, content) => {
      const id = `msg-${String(msgCounter)}`;
      msgCounter += 1;
      messages.push({
        id,
        fromAgent: from,
        toAgent: to,
        content,
        createdAt: FIXED_TS,
        readAt: undefined,
      });
      return success(id);
    },
    adminReset: notImpl,
  };
};

test("message round-trip: send encrypted, retrieve decrypted", async () => {
  const wk = deriveWorkspaceKey(E2E_PASSPHRASE, E2E_WORKSPACE);
  const storageDb = createStorageDb();
  const db = withEncryption(storageDb, wk, [wk]);

  await db.sendMessage(AGENT_ALICE, ALICE_KEY, AGENT_BOB, MSG_CONTENT);

  const rawResult = await storageDb.getMessages(AGENT_BOB, BOB_KEY);
  assert.equal(rawResult.ok, true);
  if (rawResult.ok) {
    assert.equal(rawResult.value.length, 1);
    const rawMsg = rawResult.value[0];
    assert.ok(rawMsg !== undefined);
    assert.notEqual(rawMsg.content, MSG_CONTENT);
  }

  const decResult = await db.getMessages(AGENT_BOB, BOB_KEY);
  assert.equal(decResult.ok, true);
  if (decResult.ok) {
    assert.equal(decResult.value.length, 1);
    const decMsg = decResult.value[0];
    assert.ok(decMsg !== undefined);
    assert.equal(decMsg.content, MSG_CONTENT);
    assert.equal(decMsg.fromAgent, AGENT_ALICE);
    assert.equal(decMsg.toAgent, AGENT_BOB);
  }
});

test("plan round-trip: update encrypted, retrieve decrypted", async () => {
  const wk = deriveWorkspaceKey(E2E_PASSPHRASE, E2E_WORKSPACE);
  const storageDb = createStorageDb();
  const db = withEncryption(storageDb, wk, [wk]);

  await db.updatePlan(AGENT_ALICE, ALICE_KEY, PLAN_GOAL, PLAN_TASK);

  const rawResult = await storageDb.getPlan(AGENT_ALICE);
  assert.equal(rawResult.ok, true);
  if (rawResult.ok && rawResult.value !== null) {
    assert.notEqual(rawResult.value.goal, PLAN_GOAL);
    assert.notEqual(rawResult.value.currentTask, PLAN_TASK);
    assert.equal(rawResult.value.agentName, AGENT_ALICE);
  }

  const decResult = await db.getPlan(AGENT_ALICE);
  assert.equal(decResult.ok, true);
  if (decResult.ok && decResult.value !== null) {
    assert.equal(decResult.value.goal, PLAN_GOAL);
    assert.equal(decResult.value.currentTask, PLAN_TASK);
    assert.equal(decResult.value.agentName, AGENT_ALICE);
  }
});

test("lock round-trip: acquire encrypted reason, query decrypted", async () => {
  const wk = deriveWorkspaceKey(E2E_PASSPHRASE, E2E_WORKSPACE);
  const storageDb = createStorageDb();
  const db = withEncryption(storageDb, wk, [wk]);

  await db.acquireLock(
    LOCK_FILE, AGENT_ALICE, ALICE_KEY, LOCK_REASON, LOCK_TIMEOUT,
  );

  const rawResult = await storageDb.queryLock(LOCK_FILE);
  assert.equal(rawResult.ok, true);
  if (rawResult.ok && rawResult.value !== null) {
    assert.notEqual(rawResult.value.reason, LOCK_REASON);
    assert.equal(rawResult.value.agentName, AGENT_ALICE);
  }

  const decResult = await db.queryLock(LOCK_FILE);
  assert.equal(decResult.ok, true);
  if (decResult.ok && decResult.value !== null) {
    assert.equal(decResult.value.reason, LOCK_REASON);
    assert.equal(decResult.value.filePath, LOCK_FILE);
    assert.equal(decResult.value.agentName, AGENT_ALICE);
  }
});

test("listLocks round-trip: multiple locks encrypted, listed decrypted", async () => {
  const wk = deriveWorkspaceKey(E2E_PASSPHRASE, E2E_WORKSPACE);
  const storageDb = createStorageDb();
  const db = withEncryption(storageDb, wk, [wk]);

  const secondFile = "/src/auth/tokens.ts";
  const secondReason = "adding refresh token support";
  await db.acquireLock(
    LOCK_FILE, AGENT_ALICE, ALICE_KEY, LOCK_REASON, LOCK_TIMEOUT,
  );
  await db.acquireLock(
    secondFile, AGENT_BOB, BOB_KEY, secondReason, LOCK_TIMEOUT,
  );

  const rawResult = await storageDb.listLocks();
  assert.equal(rawResult.ok, true);
  if (rawResult.ok) {
    const expectedLockCount = 2;
    assert.equal(rawResult.value.length, expectedLockCount);
    for (const lock of rawResult.value) {
      assert.notEqual(lock.reason, LOCK_REASON);
      assert.notEqual(lock.reason, secondReason);
    }
  }

  const decResult = await db.listLocks();
  assert.equal(decResult.ok, true);
  if (decResult.ok) {
    const expectedLockCount = 2;
    assert.equal(decResult.value.length, expectedLockCount);
    const reasons = decResult.value.map((l) => l.reason);
    assert.ok(reasons.includes(LOCK_REASON));
    assert.ok(reasons.includes(secondReason));
  }
});

test("listPlans round-trip: multiple plans encrypted, listed decrypted", async () => {
  const wk = deriveWorkspaceKey(E2E_PASSPHRASE, E2E_WORKSPACE);
  const storageDb = createStorageDb();
  const db = withEncryption(storageDb, wk, [wk]);

  const bobGoal = "Set up CI/CD pipeline";
  const bobTask = "Configuring GitHub Actions";
  await db.updatePlan(AGENT_ALICE, ALICE_KEY, PLAN_GOAL, PLAN_TASK);
  await db.updatePlan(AGENT_BOB, BOB_KEY, bobGoal, bobTask);

  const rawResult = await storageDb.listPlans();
  assert.equal(rawResult.ok, true);
  if (rawResult.ok) {
    const expectedPlanCount = 2;
    assert.equal(rawResult.value.length, expectedPlanCount);
    for (const plan of rawResult.value) {
      assert.notEqual(plan.goal, PLAN_GOAL);
      assert.notEqual(plan.goal, bobGoal);
    }
  }

  const decResult = await db.listPlans();
  assert.equal(decResult.ok, true);
  if (decResult.ok) {
    const expectedPlanCount = 2;
    assert.equal(decResult.value.length, expectedPlanCount);
    const alicePlan = decResult.value.find((p) => p.agentName === AGENT_ALICE);
    const bobPlan = decResult.value.find((p) => p.agentName === AGENT_BOB);
    assert.ok(alicePlan !== undefined);
    assert.ok(bobPlan !== undefined);
    assert.equal(alicePlan.goal, PLAN_GOAL);
    assert.equal(alicePlan.currentTask, PLAN_TASK);
    assert.equal(bobPlan.goal, bobGoal);
    assert.equal(bobPlan.currentTask, bobTask);
  }
});

test("listAllMessages round-trip: all messages encrypted, listed decrypted", async () => {
  const wk = deriveWorkspaceKey(E2E_PASSPHRASE, E2E_WORKSPACE);
  const storageDb = createStorageDb();
  const db = withEncryption(storageDb, wk, [wk]);

  const secondContent = "Looks good, merging now";
  await db.sendMessage(AGENT_ALICE, ALICE_KEY, AGENT_BOB, MSG_CONTENT);
  await db.sendMessage(AGENT_BOB, BOB_KEY, AGENT_ALICE, secondContent);

  const rawResult = await storageDb.listAllMessages();
  assert.equal(rawResult.ok, true);
  if (rawResult.ok) {
    const expectedMsgCount = 2;
    assert.equal(rawResult.value.length, expectedMsgCount);
    for (const msg of rawResult.value) {
      assert.notEqual(msg.content, MSG_CONTENT);
      assert.notEqual(msg.content, secondContent);
    }
  }

  const decResult = await db.listAllMessages();
  assert.equal(decResult.ok, true);
  if (decResult.ok) {
    const expectedMsgCount = 2;
    assert.equal(decResult.value.length, expectedMsgCount);
    const contents = decResult.value.map((m) => m.content);
    assert.ok(contents.includes(MSG_CONTENT));
    assert.ok(contents.includes(secondContent));
  }
});

test("adminSendMessage round-trip: admin message encrypted, retrieved decrypted", async () => {
  const wk = deriveWorkspaceKey(E2E_PASSPHRASE, E2E_WORKSPACE);
  const storageDb = createStorageDb();
  const db = withEncryption(storageDb, wk, [wk]);

  const adminContent = "System maintenance at 3am UTC";
  await db.adminSendMessage(AGENT_ALICE, AGENT_BOB, adminContent);

  const rawResult = await storageDb.getMessages(AGENT_BOB, BOB_KEY);
  assert.equal(rawResult.ok, true);
  if (rawResult.ok) {
    assert.equal(rawResult.value.length, 1);
    const rawMsg = rawResult.value[0];
    assert.ok(rawMsg !== undefined);
    assert.notEqual(rawMsg.content, adminContent);
  }

  const decResult = await db.getMessages(AGENT_BOB, BOB_KEY);
  assert.equal(decResult.ok, true);
  if (decResult.ok) {
    assert.equal(decResult.value.length, 1);
    const decMsg = decResult.value[0];
    assert.ok(decMsg !== undefined);
    assert.equal(decMsg.content, adminContent);
  }
});

test("key rotation: old ciphertext decryptable with keychain", async () => {
  const oldPassphrase = "old-workspace-secret";
  const oldWk = deriveWorkspaceKey(oldPassphrase, E2E_WORKSPACE);
  const newWk = {
    ...deriveWorkspaceKey(E2E_PASSPHRASE, E2E_WORKSPACE),
    version: 2,
  };
  const rotatedOldWk = { ...oldWk, version: 1 };
  const keychain = [newWk, rotatedOldWk];

  const storageDb = createStorageDb();
  const oldDb = withEncryption(storageDb, rotatedOldWk, [rotatedOldWk]);
  await oldDb.sendMessage(AGENT_ALICE, ALICE_KEY, AGENT_BOB, MSG_CONTENT);

  const newDb = withEncryption(storageDb, newWk, keychain);
  const result = await newDb.getMessages(AGENT_BOB, BOB_KEY);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.length, 1);
    const msg = result.value[0];
    assert.ok(msg !== undefined);
    assert.equal(msg.content, MSG_CONTENT);
  }
});

test("routing fields remain plaintext through encryption", async () => {
  const wk = deriveWorkspaceKey(E2E_PASSPHRASE, E2E_WORKSPACE);
  const storageDb = createStorageDb();
  const db = withEncryption(storageDb, wk, [wk]);

  await db.sendMessage(AGENT_ALICE, ALICE_KEY, AGENT_BOB, MSG_CONTENT);
  await db.updatePlan(AGENT_ALICE, ALICE_KEY, PLAN_GOAL, PLAN_TASK);
  await db.acquireLock(
    LOCK_FILE, AGENT_ALICE, ALICE_KEY, LOCK_REASON, LOCK_TIMEOUT,
  );

  const rawMsg = await storageDb.getMessages(AGENT_BOB, BOB_KEY);
  assert.equal(rawMsg.ok, true);
  if (rawMsg.ok) {
    const msg = rawMsg.value[0];
    assert.ok(msg !== undefined);
    assert.equal(msg.fromAgent, AGENT_ALICE);
    assert.equal(msg.toAgent, AGENT_BOB);
  }

  const rawPlan = await storageDb.getPlan(AGENT_ALICE);
  assert.equal(rawPlan.ok, true);
  if (rawPlan.ok && rawPlan.value !== null) {
    assert.equal(rawPlan.value.agentName, AGENT_ALICE);
  }

  const rawLock = await storageDb.queryLock(LOCK_FILE);
  assert.equal(rawLock.ok, true);
  if (rawLock.ok && rawLock.value !== null) {
    assert.equal(rawLock.value.filePath, LOCK_FILE);
    assert.equal(rawLock.value.agentName, AGENT_ALICE);
  }
});

test("server never sees plaintext content", async () => {
  const wk = deriveWorkspaceKey(E2E_PASSPHRASE, E2E_WORKSPACE);
  const storageDb = createStorageDb();
  const db = withEncryption(storageDb, wk, [wk]);

  await db.sendMessage(AGENT_ALICE, ALICE_KEY, AGENT_BOB, MSG_CONTENT);
  await db.updatePlan(AGENT_ALICE, ALICE_KEY, PLAN_GOAL, PLAN_TASK);
  await db.acquireLock(
    LOCK_FILE, AGENT_ALICE, ALICE_KEY, LOCK_REASON, LOCK_TIMEOUT,
  );

  const rawMessages = await storageDb.listAllMessages();
  assert.equal(rawMessages.ok, true);
  if (rawMessages.ok) {
    for (const msg of rawMessages.value) {
      assert.notEqual(msg.content, MSG_CONTENT);
      assert.ok(!msg.content.includes(MSG_CONTENT));
    }
  }

  const rawPlans = await storageDb.listPlans();
  assert.equal(rawPlans.ok, true);
  if (rawPlans.ok) {
    for (const plan of rawPlans.value) {
      assert.notEqual(plan.goal, PLAN_GOAL);
      assert.notEqual(plan.currentTask, PLAN_TASK);
      assert.ok(!plan.goal.includes(PLAN_GOAL));
      assert.ok(!plan.currentTask.includes(PLAN_TASK));
    }
  }

  const rawLocks = await storageDb.listLocks();
  assert.equal(rawLocks.ok, true);
  if (rawLocks.ok) {
    for (const lock of rawLocks.value) {
      assert.notEqual(lock.reason, LOCK_REASON);
      assert.ok(!lock.reason?.includes(LOCK_REASON));
    }
  }
});
