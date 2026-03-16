/// Integration tests for the encryption middleware.
///
/// Uses an in-memory mock TooManyCooksDb to verify that content fields
/// are encrypted before reaching the db and decrypted after reading.

import { strict as assert } from "node:assert";
import test from "node:test";

import type {
  AgentPlan,
  FileLock,
  Message,
  TooManyCooksDb,
} from "@too-many-cooks/core";
import { success } from "@too-many-cooks/core";

import { deriveWorkspaceKey, encrypt } from "../src/crypto.js";
import { withEncryption } from "../src/encryption-middleware.js";

/** Test passphrase. */
const TEST_PASSPHRASE = "test-secret";

/** Test workspace ID. */
const TEST_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

/** Test agent name. */
const TEST_AGENT = "test-agent";

/** Test agent key. */
const TEST_KEY = "test-key-abc123";

/** Test message content (plaintext). */
const TEST_CONTENT = "build the auth module";

/** Test plan goal (plaintext). */
const TEST_GOAL = "Fix login bug";

/** Test plan current task (plaintext). */
const TEST_TASK = "Writing tests";

/** Test lock reason (plaintext). */
const TEST_REASON = "editing auth.ts";

/** Test file path. */
const TEST_FILE = "/src/auth.ts";

/** Fixed timestamp for tests. */
const FIXED_TIMESTAMP = 1700000000000;

/** Fixed message ID. */
const FIXED_MSG_ID = "msg-001";

/** Create a minimal mock db that captures encrypted values. */
const createMockDb = (): {
  readonly db: TooManyCooksDb;
  readonly captured: { content: string; goal: string; task: string; reason: string };
} => {
  const captured = { content: "", goal: "", task: "", reason: "" };

  const notImplemented = (): never => {
    throw new Error("Not implemented in mock");
  };

  const db: TooManyCooksDb = {
    register: notImplemented,
    authenticate: notImplemented,
    lookupByKey: notImplemented,
    listAgents: notImplemented,
    acquireLock: async (_fp, _an, _ak, reason, _t) => {
      captured.reason = reason ?? "";
      const lock: FileLock = {
        filePath: TEST_FILE,
        agentName: TEST_AGENT,
        acquiredAt: FIXED_TIMESTAMP,
        expiresAt: FIXED_TIMESTAMP,
        reason: reason ?? null,
        version: 1,
      };
      return success({ acquired: true, lock, error: undefined });
    },
    releaseLock: notImplemented,
    forceReleaseLock: notImplemented,
    queryLock: async (_fp) => {
      const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
      const lock: FileLock = {
        filePath: TEST_FILE,
        agentName: TEST_AGENT,
        acquiredAt: FIXED_TIMESTAMP,
        expiresAt: FIXED_TIMESTAMP,
        reason: encrypt(TEST_REASON, wk),
        version: 1,
      };
      return success(lock);
    },
    listLocks: async () => success([]),
    renewLock: notImplemented,
    sendMessage: async (_from, _key, _to, content) => {
      captured.content = content;
      return success(FIXED_MSG_ID);
    },
    getMessages: async () => {
      const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
      const msg: Message = {
        id: FIXED_MSG_ID,
        fromAgent: TEST_AGENT,
        toAgent: TEST_AGENT,
        content: encrypt(TEST_CONTENT, wk),
        createdAt: FIXED_TIMESTAMP,
        readAt: undefined,
      };
      return success([msg]);
    },
    markRead: notImplemented,
    updatePlan: async (_an, _ak, goal, task) => {
      captured.goal = goal;
      captured.task = task;
      return success(undefined);
    },
    getPlan: async () => {
      const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
      const plan: AgentPlan = {
        agentName: TEST_AGENT,
        goal: encrypt(TEST_GOAL, wk),
        currentTask: encrypt(TEST_TASK, wk),
        updatedAt: FIXED_TIMESTAMP,
      };
      return success(plan);
    },
    listPlans: async () => success([]),
    listAllMessages: async () => success([]),
    activate: notImplemented,
    deactivate: notImplemented,
    deactivateAll: notImplemented,
    close: async () => success(undefined),
    adminDeleteLock: notImplemented,
    adminDeleteAgent: notImplemented,
    adminResetKey: notImplemented,
    adminSendMessage: async (_from, _to, content) => {
      captured.content = content;
      return success(FIXED_MSG_ID);
    },
    adminReset: notImplemented,
  };

  return { db, captured };
};

test("sendMessage encrypts content before passing to db", async () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const { db, captured } = createMockDb();
  const encrypted = withEncryption(db, wk, [wk]);
  await encrypted.sendMessage(TEST_AGENT, TEST_KEY, TEST_AGENT, TEST_CONTENT);
  assert.notEqual(captured.content, TEST_CONTENT);
  assert.notEqual(captured.content, "");
});

test("getMessages decrypts content from db", async () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const { db } = createMockDb();
  const encrypted = withEncryption(db, wk, [wk]);
  const result = await encrypted.getMessages(TEST_AGENT, TEST_KEY);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.length, 1);
    const firstMsg = result.value[0];
    assert.ok(firstMsg !== undefined);
    assert.equal(firstMsg.content, TEST_CONTENT);
  }
});

test("updatePlan encrypts goal and currentTask", async () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const { db, captured } = createMockDb();
  const encrypted = withEncryption(db, wk, [wk]);
  await encrypted.updatePlan(TEST_AGENT, TEST_KEY, TEST_GOAL, TEST_TASK);
  assert.notEqual(captured.goal, TEST_GOAL);
  assert.notEqual(captured.task, TEST_TASK);
});

test("getPlan decrypts goal and currentTask", async () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const { db } = createMockDb();
  const encrypted = withEncryption(db, wk, [wk]);
  const result = await encrypted.getPlan(TEST_AGENT);
  assert.equal(result.ok, true);
  if (result.ok && result.value !== null) {
    assert.equal(result.value.goal, TEST_GOAL);
    assert.equal(result.value.currentTask, TEST_TASK);
  }
});

test("acquireLock encrypts reason", async () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const { db, captured } = createMockDb();
  const encrypted = withEncryption(db, wk, [wk]);
  await encrypted.acquireLock(
    TEST_FILE, TEST_AGENT, TEST_KEY, TEST_REASON, FIXED_TIMESTAMP,
  );
  assert.notEqual(captured.reason, TEST_REASON);
  assert.notEqual(captured.reason, "");
});

test("queryLock decrypts reason", async () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const { db } = createMockDb();
  const encrypted = withEncryption(db, wk, [wk]);
  const result = await encrypted.queryLock(TEST_FILE);
  assert.equal(result.ok, true);
  if (result.ok && result.value !== null) {
    assert.equal(result.value.reason, TEST_REASON);
  }
});

test("adminSendMessage encrypts content", async () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const { db, captured } = createMockDb();
  const encrypted = withEncryption(db, wk, [wk]);
  await encrypted.adminSendMessage(TEST_AGENT, TEST_AGENT, TEST_CONTENT);
  assert.notEqual(captured.content, TEST_CONTENT);
});

test("acquireLock with null reason passes null through", async () => {
  const wk = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);
  const { db, captured } = createMockDb();
  const encrypted = withEncryption(db, wk, [wk]);
  await encrypted.acquireLock(
    TEST_FILE, TEST_AGENT, TEST_KEY, null, FIXED_TIMESTAMP,
  );
  assert.equal(captured.reason, "");
});
