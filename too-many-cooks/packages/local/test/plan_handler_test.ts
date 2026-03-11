/// Tests for plan tool handler (direct import, not via spawned server).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type TooManyCooksDb,
  createDataConfig,
  createNotificationEmitter,
  createLoggerWithContext,
  createLoggingContext,
  createPlanHandler,
} from "@too-many-cooks/core";
import type { SessionIdentity } from "@too-many-cooks/core";
import { createDb } from "../src/db-sqlite.js";

const TEST_DB_PATH = ".test_plan_handler.db";

const deleteIfExists = (filePath: string): void => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore
  }
};

const createTestEmitter = () => {
  const server = new McpServer(
    { name: "test", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false }, logging: {} } },
  );
  return createNotificationEmitter(server);
};

const createTestLogger = () =>
  createLoggerWithContext(createLoggingContext());

describe("plan handler", () => {
  let db: TooManyCooksDb | undefined;
  let agentName = "";
  let agentKey = "";

  beforeEach(async () => {
    deleteIfExists(TEST_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { throw new Error("expected ok"); }
    db = result.value;

    const regResult = await db.register("plan-agent");
    if (!regResult.ok) { throw new Error("expected ok"); }
    agentName = regResult.value.agentName;
    agentKey = regResult.value.agentKey;
  });

  afterEach(() => {
    db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  const makeSession = (): (() => SessionIdentity) =>
    () => ({ agentName, agentKey });

  it("update succeeds with goal and current_task", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createPlanHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "update", goal: "Fix bugs", current_task: "Reading code" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.updated, true);
  });

  it("get returns plan after update", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createPlanHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    await handler({ action: "update", goal: "Ship feature", current_task: "Writing tests" }, {});
    const result = await handler({ action: "get" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    const plan = parsed.plan as Record<string, unknown>;
    assert.strictEqual(plan.goal, "Ship feature");
    assert.strictEqual(plan.current_task, "Writing tests");
  });

  it("get returns null when no plan", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createPlanHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "get" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.plan, null);
  });

  it("list returns all plans", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createPlanHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    await handler({ action: "update", goal: "Goal A", current_task: "Task A" }, {});

    // Register second agent and set plan
    const reg2 = await db.register("plan-agent-2");
    if (!reg2.ok) { throw new Error("expected ok"); }
    const getSession2 = (): SessionIdentity => ({
      agentName: reg2.value.agentName,
      agentKey: reg2.value.agentKey,
    });
    const handler2 = createPlanHandler(db, createTestEmitter(), createTestLogger(), getSession2);
    await handler2({ action: "update", goal: "Goal B", current_task: "Task B" }, {});

    const result = await handler({ action: "list" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(Array.isArray(parsed.plans), true);
    assert.strictEqual((parsed.plans as unknown[]).length, 2);
  });

  it("fails when action is missing", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createPlanHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({}, {});
    assert.strictEqual(result.isError, true);
  });

  it("fails with unknown action", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createPlanHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "delete" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("update fails without goal", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createPlanHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "update", current_task: "stuff" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("update fails without current_task", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createPlanHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "update", goal: "stuff" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("fails when not registered and no session", async () => {
    if (!db) { throw new Error("expected db"); }
    const getSession = (): SessionIdentity | null => null;
    const handler = createPlanHandler(db, createTestEmitter(), createTestLogger(), getSession);
    const result = await handler({ action: "update", goal: "g", current_task: "t" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("works with agent_key override", async () => {
    if (!db) { throw new Error("expected db"); }
    const getSession = (): SessionIdentity | null => null;
    const handler = createPlanHandler(db, createTestEmitter(), createTestLogger(), getSession);
    const result = await handler({ action: "update", goal: "via key", current_task: "testing", agent_key: agentKey }, {});
    assert.strictEqual(result.isError, false);
  });

  it("list works without registration", async () => {
    if (!db) { throw new Error("expected db"); }
    const getSession = (): SessionIdentity | null => null;
    const handler = createPlanHandler(db, createTestEmitter(), createTestLogger(), getSession);
    const result = await handler({ action: "list" }, {});
    assert.strictEqual(result.isError, false);
  });
});
