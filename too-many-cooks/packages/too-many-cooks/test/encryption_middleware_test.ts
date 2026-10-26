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
} from "too-many-cooks-core";
import { success } from "too-many-cooks-core";

import { type WorkspaceKey, deriveWorkspaceKey, encrypt } from "../src/crypto.js";
import { withEncryption } from "../src/encryption-middleware.js";
import { createInMemoryDb } from "./support/in_memory_db.js";

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

/** Lock version written by the mock db. */
const LOCK_VERSION = 1;

/** Derived workspace key shared by the mock and the encrypted wrapper. */
const TEST_WK: WorkspaceKey = deriveWorkspaceKey(TEST_PASSPHRASE, TEST_WORKSPACE_ID);

/** Plaintext fields the mock captured while encrypting. */
type CapturedFields = {
  content: string;
  goal: string;
  task: string;
  reason: string;
};

/** Create a minimal mock db that captures encrypted values. */
const createMockDb = (): {
  readonly db: TooManyCooksDb;
  readonly captured: CapturedFields;
} => {
  const captured: CapturedFields = { content: "", goal: "", task: "", reason: "" };

  const db = createInMemoryDb({
    acquireLock: async (_fp, _an, _ak, reason, _t) => {
      captured.reason = reason ?? "";
      const lock: FileLock = {
        filePath: TEST_FILE,
        agentName: TEST_AGENT,
        acquiredAt: FIXED_TIMESTAMP,
        expiresAt: FIXED_TIMESTAMP,
        reason: reason ?? null,
        version: LOCK_VERSION,
      };
      return success({ acquired: true, lock, error: undefined });
    },
    queryLock: async () => {
      const lock: FileLock = {
        filePath: TEST_FILE,
        agentName: TEST_AGENT,
        acquiredAt: FIXED_TIMESTAMP,
        expiresAt: FIXED_TIMESTAMP,
        reason: encrypt(TEST_REASON, TEST_WK),
        version: LOCK_VERSION,
      };
      return success(lock);
    },
    listLocks: async () => success([]),
    sendMessage: async (_from, _key, _to, content) => {
      captured.content = content;
      return success(FIXED_MSG_ID);
    },
    getMessages: async () => {
      const msg: Message = {
        id: FIXED_MSG_ID,
        fromAgent: TEST_AGENT,
        toAgent: TEST_AGENT,
        content: encrypt(TEST_CONTENT, TEST_WK),
        createdAt: FIXED_TIMESTAMP,
        readAt: undefined,
      };
      return success([msg]);
    },
    updatePlan: async (_an, _ak, goal, task) => {
      captured.goal = goal;
      captured.task = task;
      return success(undefined);
    },
    getPlan: async () => {
      const plan: AgentPlan = {
        agentName: TEST_AGENT,
        goal: encrypt(TEST_GOAL, TEST_WK),
        currentTask: encrypt(TEST_TASK, TEST_WK),
        updatedAt: FIXED_TIMESTAMP,
      };
      return success(plan);
    },
    listPlans: async () => success([]),
    listAllMessages: async () => success([]),
    close: async () => success(undefined),
    adminSendMessage: async (_from, _to, content) => {
      captured.content = content;
      return success(FIXED_MSG_ID);
    },
  });

  return { db, captured };
};

/** Mock db wrapped in encryption middleware, plus its captured plaintexts. */
const createEncryptedMock = (): {
  readonly encrypted: TooManyCooksDb;
  readonly captured: CapturedFields;
} => {
  const { db, captured } = createMockDb();
  return { encrypted: withEncryption(db, TEST_WK, [TEST_WK]), captured };
};

test("sendMessage encrypts content before passing to db", async () => {
  const { encrypted, captured } = createEncryptedMock();
  await encrypted.sendMessage(TEST_AGENT, TEST_KEY, TEST_AGENT, TEST_CONTENT);
  assert.notEqual(captured.content, TEST_CONTENT);
  assert.notEqual(captured.content, "");
});

test("getMessages decrypts content from db", async () => {
  const { encrypted } = createEncryptedMock();
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
  const { encrypted, captured } = createEncryptedMock();
  await encrypted.updatePlan(TEST_AGENT, TEST_KEY, TEST_GOAL, TEST_TASK);
  assert.notEqual(captured.goal, TEST_GOAL);
  assert.notEqual(captured.task, TEST_TASK);
});

test("getPlan decrypts goal and currentTask", async () => {
  const { encrypted } = createEncryptedMock();
  const result = await encrypted.getPlan(TEST_AGENT);
  assert.equal(result.ok, true);
  if (result.ok && result.value !== null) {
    assert.equal(result.value.goal, TEST_GOAL);
    assert.equal(result.value.currentTask, TEST_TASK);
  }
});

test("acquireLock encrypts reason", async () => {
  const { encrypted, captured } = createEncryptedMock();
  await encrypted.acquireLock(
    TEST_FILE, TEST_AGENT, TEST_KEY, TEST_REASON, FIXED_TIMESTAMP,
  );
  assert.notEqual(captured.reason, TEST_REASON);
  assert.notEqual(captured.reason, "");
});

test("queryLock decrypts reason", async () => {
  const { encrypted } = createEncryptedMock();
  const result = await encrypted.queryLock(TEST_FILE);
  assert.equal(result.ok, true);
  if (result.ok && result.value !== null) {
    assert.equal(result.value.reason, TEST_REASON);
  }
});

test("adminSendMessage encrypts content", async () => {
  const { encrypted, captured } = createEncryptedMock();
  await encrypted.adminSendMessage(TEST_AGENT, TEST_AGENT, TEST_CONTENT);
  assert.notEqual(captured.content, TEST_CONTENT);
});

test("acquireLock with null reason passes null through", async () => {
  const { encrypted, captured } = createEncryptedMock();
  await encrypted.acquireLock(
    TEST_FILE, TEST_AGENT, TEST_KEY, null, FIXED_TIMESTAMP,
  );
  assert.equal(captured.reason, "");
});
