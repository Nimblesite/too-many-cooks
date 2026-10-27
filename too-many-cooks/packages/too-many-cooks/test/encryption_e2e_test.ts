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
import { createInMemoryDb } from "./support/in_memory_db.js";
import { assertNonNullish, expectOk } from "./support/assertions.js";

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

  const pushMessage = (from: string, to: string, content: string): string => {
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
    return id;
  };

  return createInMemoryDb({
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
    queryLock: async (fp) => {
      const lock = locks.get(fp);
      return success(lock ?? null);
    },
    listLocks: async () => success([...locks.values()]),
    sendMessage: async (from, _key, to, content) =>
      success(pushMessage(from, to, content)),
    getMessages: async (an) => {
      const filtered = messages.filter((m) => m.toAgent === an);
      return success(filtered);
    },
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
    close: async () => success(undefined),
    adminSendMessage: async (from, to, content) =>
      success(pushMessage(from, to, content)),
  });
};

/** Fresh encrypted db plus its underlying storage db (which sees only ciphertext). */
const createEncryptedDb = (): { readonly storageDb: TooManyCooksDb; readonly db: TooManyCooksDb } => {
  const wk = deriveWorkspaceKey(E2E_PASSPHRASE, E2E_WORKSPACE);
  const storageDb = createStorageDb();
  const db = withEncryption(storageDb, wk, [wk]);
  return { storageDb, db };
};

/** Message count a round-trip test expects in bob's inbox. */
const SINGLE_MESSAGE = 1;

/** Messages bob's inbox holds when read through `db`, asserting the count. */
const bobInboxThrough = async (
  db: TooManyCooksDb,
  expectedCount: number,
): Promise<readonly Message[]> => {
  const messages = expectOk(
    await db.getMessages(AGENT_BOB, BOB_KEY),
    "get must be ok",
  );
  assert.equal(messages.length, expectedCount);
  return messages;
};

/** The single message bob's inbox holds when read through `db`. */
const soleBobMessage = async (
  db: TooManyCooksDb,
  label: string,
): Promise<Message> => assertNonNullish((await bobInboxThrough(db, SINGLE_MESSAGE))[0], label);

test("message round-trip: send encrypted, retrieve decrypted", async () => {
  const { storageDb, db } = createEncryptedDb();

  await db.sendMessage(AGENT_ALICE, ALICE_KEY, AGENT_BOB, MSG_CONTENT);

  const rawMsg = await soleBobMessage(storageDb, "raw message");
  assert.notEqual(rawMsg.content, MSG_CONTENT);

  const decMsg = await soleBobMessage(db, "decrypted message");
  assert.equal(decMsg.content, MSG_CONTENT);
  assert.equal(decMsg.fromAgent, AGENT_ALICE);
  assert.equal(decMsg.toAgent, AGENT_BOB);
});

test("plan round-trip: update encrypted, retrieve decrypted", async () => {
  const { storageDb, db } = createEncryptedDb();

  await db.updatePlan(AGENT_ALICE, ALICE_KEY, PLAN_GOAL, PLAN_TASK);

  const rawPlan = assertNonNullish(
    expectOk(await storageDb.getPlan(AGENT_ALICE), "raw plan must be ok"),
    "raw plan must exist",
  );
  assert.notEqual(rawPlan.goal, PLAN_GOAL);
  assert.notEqual(rawPlan.currentTask, PLAN_TASK);
  assert.equal(rawPlan.agentName, AGENT_ALICE);

  const decPlan = assertNonNullish(
    expectOk(await db.getPlan(AGENT_ALICE), "dec plan must be ok"),
    "dec plan must exist",
  );
  assert.equal(decPlan.goal, PLAN_GOAL);
  assert.equal(decPlan.currentTask, PLAN_TASK);
  assert.equal(decPlan.agentName, AGENT_ALICE);
});

test("lock round-trip: acquire encrypted reason, query decrypted", async () => {
  const { storageDb, db } = createEncryptedDb();

  await db.acquireLock(
    LOCK_FILE, AGENT_ALICE, ALICE_KEY, LOCK_REASON, LOCK_TIMEOUT,
  );

  const rawLock = assertNonNullish(
    expectOk(await storageDb.queryLock(LOCK_FILE), "raw query must be ok"),
    "raw lock must exist",
  );
  assert.notEqual(rawLock.reason, LOCK_REASON);
  assert.equal(rawLock.agentName, AGENT_ALICE);

  const decLock = assertNonNullish(
    expectOk(await db.queryLock(LOCK_FILE), "dec query must be ok"),
    "dec lock must exist",
  );
  assert.equal(decLock.reason, LOCK_REASON);
  assert.equal(decLock.filePath, LOCK_FILE);
  assert.equal(decLock.agentName, AGENT_ALICE);
});

test("listLocks round-trip: multiple locks encrypted, listed decrypted", async () => {
  const { storageDb, db } = createEncryptedDb();

  const secondFile = "/src/auth/tokens.ts";
  const secondReason = "adding refresh token support";
  await db.acquireLock(
    LOCK_FILE, AGENT_ALICE, ALICE_KEY, LOCK_REASON, LOCK_TIMEOUT,
  );
  await db.acquireLock(
    secondFile, AGENT_BOB, BOB_KEY, secondReason, LOCK_TIMEOUT,
  );

  const rawLocks = expectOk(await storageDb.listLocks(), "raw list must be ok");
  const expectedLockCount = 2;
  assert.equal(rawLocks.length, expectedLockCount);
  for (const lock of rawLocks) {
    assert.notEqual(lock.reason, LOCK_REASON);
    assert.notEqual(lock.reason, secondReason);
  }

  const decLocks = expectOk(await db.listLocks(), "dec list must be ok");
  assert.equal(decLocks.length, expectedLockCount);
  const reasons = decLocks.map((l) => l.reason);
  assert.ok(reasons.includes(LOCK_REASON));
  assert.ok(reasons.includes(secondReason));
});

test("listPlans round-trip: multiple plans encrypted, listed decrypted", async () => {
  const { storageDb, db } = createEncryptedDb();

  const bobGoal = "Set up CI/CD pipeline";
  const bobTask = "Configuring GitHub Actions";
  await db.updatePlan(AGENT_ALICE, ALICE_KEY, PLAN_GOAL, PLAN_TASK);
  await db.updatePlan(AGENT_BOB, BOB_KEY, bobGoal, bobTask);

  const rawPlans = expectOk(await storageDb.listPlans(), "raw list must be ok");
  const expectedPlanCount = 2;
  assert.equal(rawPlans.length, expectedPlanCount);
  for (const plan of rawPlans) {
    assert.notEqual(plan.goal, PLAN_GOAL);
    assert.notEqual(plan.goal, bobGoal);
  }

  const decPlans = expectOk(await db.listPlans(), "dec list must be ok");
  assert.equal(decPlans.length, expectedPlanCount);
  const alicePlan = decPlans.find((p) => p.agentName === AGENT_ALICE);
  const bobPlan = decPlans.find((p) => p.agentName === AGENT_BOB);
  assert.ok(alicePlan !== undefined);
  assert.ok(bobPlan !== undefined);
  assert.equal(alicePlan.goal, PLAN_GOAL);
  assert.equal(alicePlan.currentTask, PLAN_TASK);
  assert.equal(bobPlan.goal, bobGoal);
  assert.equal(bobPlan.currentTask, bobTask);
});

test("listAllMessages round-trip: all messages encrypted, listed decrypted", async () => {
  const { storageDb, db } = createEncryptedDb();

  const secondContent = "Looks good, merging now";
  await db.sendMessage(AGENT_ALICE, ALICE_KEY, AGENT_BOB, MSG_CONTENT);
  await db.sendMessage(AGENT_BOB, BOB_KEY, AGENT_ALICE, secondContent);

  const rawMessages = expectOk(
    await storageDb.listAllMessages(),
    "raw list must be ok",
  );
  const expectedMsgCount = 2;
  assert.equal(rawMessages.length, expectedMsgCount);
  for (const msg of rawMessages) {
    assert.notEqual(msg.content, MSG_CONTENT);
    assert.notEqual(msg.content, secondContent);
  }

  const decMessages = expectOk(
    await db.listAllMessages(),
    "dec list must be ok",
  );
  assert.equal(decMessages.length, expectedMsgCount);
  const contents = decMessages.map((m) => m.content);
  assert.ok(contents.includes(MSG_CONTENT));
  assert.ok(contents.includes(secondContent));
});

test("adminSendMessage round-trip: admin message encrypted, retrieved decrypted", async () => {
  const { storageDb, db } = createEncryptedDb();

  const adminContent = "System maintenance at 3am UTC";
  await db.adminSendMessage(AGENT_ALICE, AGENT_BOB, adminContent);

  const rawMsg = await soleBobMessage(storageDb, "raw message");
  assert.notEqual(rawMsg.content, adminContent);

  const decMsg = await soleBobMessage(db, "decrypted message");
  assert.equal(decMsg.content, adminContent);
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
  const msg = await soleBobMessage(newDb, "decrypted message");
  assert.equal(msg.content, MSG_CONTENT);
});

test("routing fields remain plaintext through encryption", async () => {
  const { storageDb, db } = createEncryptedDb();

  await db.sendMessage(AGENT_ALICE, ALICE_KEY, AGENT_BOB, MSG_CONTENT);
  await db.updatePlan(AGENT_ALICE, ALICE_KEY, PLAN_GOAL, PLAN_TASK);
  await db.acquireLock(
    LOCK_FILE, AGENT_ALICE, ALICE_KEY, LOCK_REASON, LOCK_TIMEOUT,
  );

  const msg = await soleBobMessage(storageDb, "raw message");
  assert.equal(msg.fromAgent, AGENT_ALICE);
  assert.equal(msg.toAgent, AGENT_BOB);

  const rawPlan = assertNonNullish(
    expectOk(await storageDb.getPlan(AGENT_ALICE), "raw plan must be ok"),
    "raw plan must exist",
  );
  assert.equal(rawPlan.agentName, AGENT_ALICE);

  const rawLock = assertNonNullish(
    expectOk(await storageDb.queryLock(LOCK_FILE), "raw lock must be ok"),
    "raw lock must exist",
  );
  assert.equal(rawLock.filePath, LOCK_FILE);
  assert.equal(rawLock.agentName, AGENT_ALICE);
});

test("server never sees plaintext content", async () => {
  const { storageDb, db } = createEncryptedDb();

  await db.sendMessage(AGENT_ALICE, ALICE_KEY, AGENT_BOB, MSG_CONTENT);
  await db.updatePlan(AGENT_ALICE, ALICE_KEY, PLAN_GOAL, PLAN_TASK);
  await db.acquireLock(
    LOCK_FILE, AGENT_ALICE, ALICE_KEY, LOCK_REASON, LOCK_TIMEOUT,
  );

  const rawMessages = expectOk(
    await storageDb.listAllMessages(),
    "raw messages must be ok",
  );
  for (const msg of rawMessages) {
    assert.notEqual(msg.content, MSG_CONTENT);
    assert.ok(!msg.content.includes(MSG_CONTENT));
  }

  const rawPlans = expectOk(
    await storageDb.listPlans(),
    "raw plans must be ok",
  );
  for (const plan of rawPlans) {
    assert.notEqual(plan.goal, PLAN_GOAL);
    assert.notEqual(plan.currentTask, PLAN_TASK);
    assert.ok(!plan.goal.includes(PLAN_GOAL));
    assert.ok(!plan.currentTask.includes(PLAN_TASK));
  }

  const rawLocks = expectOk(
    await storageDb.listLocks(),
    "raw locks must be ok",
  );
  for (const lock of rawLocks) {
    assert.notEqual(lock.reason, LOCK_REASON);
    assert.ok(!lock.reason?.includes(LOCK_REASON));
  }
});
