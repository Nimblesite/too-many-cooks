/// Tests for status tool handler (direct import, not via spawned server).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import {
  type TooManyCooksDb,
  createDataConfig,
  createDb,
} from "../lib/src/data/data.js";
import { createLoggerWithContext, createLoggingContext } from "../lib/src/logger.js";
import { createStatusHandler } from "../lib/src/tools/status_tool.js";

const TEST_DB_PATH = ".test_status_handler.db";

const deleteIfExists = (filePath: string): void => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore
  }
};

const createTestLogger = () =>
  createLoggerWithContext(createLoggingContext());

describe("status handler", () => {
  let db: TooManyCooksDb | undefined;

  beforeEach(() => {
    deleteIfExists(TEST_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { throw new Error("expected ok"); }
    db = result.value;
  });

  afterEach(() => {
    db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  it("returns empty status for fresh db", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createStatusHandler(db, createTestLogger());
    const result = await handler({}, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(Array.isArray(parsed.agents), true);
    assert.strictEqual(Array.isArray(parsed.locks), true);
    assert.strictEqual(Array.isArray(parsed.plans), true);
    assert.strictEqual(Array.isArray(parsed.messages), true);
    assert.strictEqual((parsed.agents as unknown[]).length, 0);
    assert.strictEqual((parsed.locks as unknown[]).length, 0);
  });

  it("returns populated status after registrations and actions", async () => {
    if (!db) { throw new Error("expected db"); }
    // Register agents
    const reg1 = db.register("status-agent-1");
    if (!reg1.ok) { throw new Error("expected ok"); }
    const reg2 = db.register("status-agent-2");
    if (!reg2.ok) { throw new Error("expected ok"); }

    // Create some locks
    db.acquireLock("/status/file.ts", reg1.value.agentName, reg1.value.agentKey, "testing", 60000);

    // Create plans
    db.updatePlan(reg1.value.agentName, reg1.value.agentKey, "Goal 1", "Task 1");

    // Send messages
    db.sendMessage(reg1.value.agentName, reg1.value.agentKey, reg2.value.agentName, "hello");

    const handler = createStatusHandler(db, createTestLogger());
    const result = await handler({}, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual((parsed.agents as unknown[]).length, 2);
    assert.strictEqual((parsed.locks as unknown[]).length, 1);
    assert.strictEqual((parsed.plans as unknown[]).length, 1);
    assert.strictEqual((parsed.messages as unknown[]).length, 1);
  });
});
