/// Tests for pure types.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  defaultConfig,
  createDataConfig,
  createDataConfigFromWorkspace,
  getWorkspaceFolder,
  resolveDbPath,
} from "too-many-cooks-core";
import * as data from "too-many-cooks-core";
import {
  textContent,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
  ERR_LOCK_HELD,
  ERR_LOCK_EXPIRED,
  ERR_VALIDATION,
  ERR_DATABASE,
} from "too-many-cooks-core";

describe("TooManyCooksConfig", () => {
  it("defaultConfig has correct values", () => {
    // dbPath is dynamic based on HOME env var, just check it ends correctly
    assert.ok(defaultConfig.dbPath.includes(".too_many_cooks/data.db"));
    assert.strictEqual(defaultConfig.lockTimeoutMs, 600000);
    assert.strictEqual(defaultConfig.maxMessageLength, 200);
    assert.strictEqual(defaultConfig.maxPlanLength, 100);
  });

  it("custom config works", () => {
    const config = {
      dbPath: "custom.db",
      lockTimeoutMs: 1000,
      maxMessageLength: 500,
      maxPlanLength: 200,
    };
    assert.strictEqual(config.dbPath, "custom.db");
    assert.strictEqual(config.lockTimeoutMs, 1000);
  });

  it("defaultConfig matches data layer defaultConfig", () => {
    assert.strictEqual(defaultConfig.dbPath, data.defaultConfig.dbPath);
    assert.strictEqual(defaultConfig.lockTimeoutMs, data.defaultConfig.lockTimeoutMs);
    assert.strictEqual(
      defaultConfig.maxMessageLength,
      data.defaultConfig.maxMessageLength,
    );
    assert.strictEqual(defaultConfig.maxPlanLength, data.defaultConfig.maxPlanLength);
  });

  it("re-exported getWorkspaceFolder matches data package", () => {
    assert.strictEqual(getWorkspaceFolder(), data.getWorkspaceFolder());
  });

  it("re-exported resolveDbPath matches data package", () => {
    assert.strictEqual(resolveDbPath("/test"), data.resolveDbPath("/test"));
  });

  it("re-exported createDataConfigFromWorkspace matches data package", () => {
    const local = createDataConfigFromWorkspace("/test");
    const fromData = data.createDataConfigFromWorkspace("/test");
    assert.strictEqual(local.dbPath, fromData.dbPath);
  });

  it("TooManyCooksConfig is identical to TooManyCooksDataConfig", () => {
    const config = createDataConfig({ dbPath: "/test.db" });
    const dataConfig = data.createDataConfig({ dbPath: "/test.db" });
    assert.strictEqual(config.dbPath, dataConfig.dbPath);
  });
});

describe("Types", () => {
  it("AgentIdentity can be created", () => {
    const identity = {
      agentName: "test-agent",
      registeredAt: 1234567890,
      lastActive: 1234567899,
    };
    assert.strictEqual(identity.agentName, "test-agent");
    assert.strictEqual(identity.registeredAt, 1234567890);
    assert.strictEqual(identity.lastActive, 1234567899);
  });

  it("AgentRegistration can be created", () => {
    const reg = { agentName: "agent1", agentKey: "secret-key-123" };
    assert.strictEqual(reg.agentName, "agent1");
    assert.strictEqual(reg.agentKey, "secret-key-123");
  });

  it("FileLock can be created", () => {
    const lock = {
      filePath: "/src/main.dart",
      agentName: "agent1",
      acquiredAt: 1000,
      expiresAt: 2000,
      reason: "editing",
      version: 1,
    };
    assert.strictEqual(lock.filePath, "/src/main.dart");
    assert.strictEqual(lock.agentName, "agent1");
    assert.strictEqual(lock.reason, "editing");
    assert.strictEqual(lock.version, 1);
  });

  it("FileLock reason can be null", () => {
    const lock = {
      filePath: "/src/main.dart",
      agentName: "agent1",
      acquiredAt: 1000,
      expiresAt: 2000,
      reason: undefined,
      version: 1,
    };
    assert.strictEqual(lock.reason, undefined);
  });

  it("LockResult acquired true", () => {
    const result = {
      acquired: true,
      lock: {
        filePath: "/test.dart",
        agentName: "agent1",
        acquiredAt: 1000,
        expiresAt: 2000,
        reason: undefined,
        version: 1,
      },
      error: undefined,
    };
    assert.strictEqual(result.acquired, true);
    assert.notStrictEqual(result.lock, undefined);
    assert.strictEqual(result.error, undefined);
  });

  it("LockResult acquired false with error", () => {
    const result = {
      acquired: false,
      lock: undefined,
      error: "Lock held by another agent",
    };
    assert.strictEqual(result.acquired, false);
    assert.strictEqual(result.lock, undefined);
    assert.strictEqual(result.error, "Lock held by another agent");
  });

  it("Message can be created", () => {
    const msg = {
      id: "msg-123",
      fromAgent: "agent1",
      toAgent: "agent2",
      content: "Hello!",
      createdAt: 1000,
      readAt: undefined,
    };
    assert.strictEqual(msg.id, "msg-123");
    assert.strictEqual(msg.fromAgent, "agent1");
    assert.strictEqual(msg.toAgent, "agent2");
    assert.strictEqual(msg.content, "Hello!");
    assert.strictEqual(msg.readAt, undefined);
  });

  it("Message with readAt", () => {
    const msg = {
      id: "msg-123",
      fromAgent: "agent1",
      toAgent: "agent2",
      content: "Hello!",
      createdAt: 1000,
      readAt: 2000,
    };
    assert.strictEqual(msg.readAt, 2000);
  });

  it("AgentPlan can be created", () => {
    const plan = {
      agentName: "agent1",
      goal: "Fix all bugs",
      currentTask: "Reviewing code",
      updatedAt: 1000,
    };
    assert.strictEqual(plan.agentName, "agent1");
    assert.strictEqual(plan.goal, "Fix all bugs");
    assert.strictEqual(plan.currentTask, "Reviewing code");
  });

  it("DbError can be created", () => {
    const error = { code: ERR_NOT_FOUND, message: "Agent not found" };
    assert.strictEqual(error.code, "NOT_FOUND");
    assert.strictEqual(error.message, "Agent not found");
  });
});

describe("Error codes", () => {
  it("errNotFound is correct", () => {
    assert.strictEqual(ERR_NOT_FOUND, "NOT_FOUND");
  });

  it("errUnauthorized is correct", () => {
    assert.strictEqual(ERR_UNAUTHORIZED, "UNAUTHORIZED");
  });

  it("errLockHeld is correct", () => {
    assert.strictEqual(ERR_LOCK_HELD, "LOCK_HELD");
  });

  it("errLockExpired is correct", () => {
    assert.strictEqual(ERR_LOCK_EXPIRED, "LOCK_EXPIRED");
  });

  it("errValidation is correct", () => {
    assert.strictEqual(ERR_VALIDATION, "VALIDATION");
  });

  it("errDatabase is correct", () => {
    assert.strictEqual(ERR_DATABASE, "DATABASE");
  });
});

describe("textContent", () => {
  it("creates text content map", () => {
    const content = textContent("Hello world");
    assert.strictEqual(content.type, "text");
    assert.strictEqual(content.text, "Hello world");
  });

  it("handles empty string", () => {
    const content = textContent("");
    assert.strictEqual(content.type, "text");
    assert.strictEqual(content.text, "");
  });

  it("handles special characters", () => {
    const content = textContent('{"json": "value"}');
    assert.strictEqual(content.text, '{"json": "value"}');
  });
});
