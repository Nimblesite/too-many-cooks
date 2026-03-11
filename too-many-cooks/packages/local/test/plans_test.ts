/// Tests for agent plan operations.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import {
  type TooManyCooksDb,
  createDataConfig,
  ERR_UNAUTHORIZED,
  ERR_VALIDATION,
} from "@too-many-cooks/core";
import { createDb } from "../src/db-sqlite.js";

const TEST_DB_PATH = ".test_plans.db";

const deleteIfExists = (path: string): void => {
  try {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  } catch {
    // ignore
  }
};

describe("plans", () => {
  let db: TooManyCooksDb | undefined;
  let agentName = "";
  let agentKey = "";

  beforeEach(async () => {
    deleteIfExists(TEST_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    db = result.value;

    // Register test agent
    const regResult = await db.register("plan-agent");
    if (!regResult.ok) {throw new Error("expected ok");}
    const reg = regResult.value;
    agentName = reg.agentName;
    agentKey = reg.agentKey;
  });

  afterEach(async () => {
    await db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  it("updatePlan creates new plan", async () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const result = await db.updatePlan(
      agentName,
      agentKey,
      "Fix all bugs",
      "Reading codebase",
    );
    assert.strictEqual(result.ok, true);
  });

  it("updatePlan updates existing plan", async () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    await db.updatePlan(agentName, agentKey, "Goal 1", "Task 1");

    const result = await db.updatePlan(agentName, agentKey, "Goal 2", "Task 2");
    assert.strictEqual(result.ok, true);

    const getPlan = await db.getPlan(agentName);
    if (!getPlan.ok) {throw new Error("expected ok");}
    const plan = getPlan.value!;
    assert.strictEqual(plan.goal, "Goal 2");
    assert.strictEqual(plan.currentTask, "Task 2");
  });

  it("updatePlan fails with invalid credentials", async () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const result = await db.updatePlan(agentName, "wrong-key", "Goal", "Task");
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_UNAUTHORIZED);
  });

  it("updatePlan fails for goal exceeding max length", async () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const longGoal = "x".repeat(101); // Default max is 100
    const result = await db.updatePlan(agentName, agentKey, longGoal, "Task");
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_VALIDATION);
    assert.ok(result.error.message.includes("100"));
  });

  it("updatePlan fails for task exceeding max length", async () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const longTask = "x".repeat(101);
    const result = await db.updatePlan(agentName, agentKey, "Goal", longTask);
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_VALIDATION);
  });

  it("getPlan returns plan for agent", async () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    await db.updatePlan(agentName, agentKey, "My Goal", "Current Task");

    const result = await db.getPlan(agentName);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const plan = result.value;
    assert.notStrictEqual(plan, undefined);
    assert.strictEqual(plan!.agentName, agentName);
    assert.strictEqual(plan!.goal, "My Goal");
    assert.strictEqual(plan!.currentTask, "Current Task");
    assert.ok(plan!.updatedAt > 0);
  });

  it("getPlan returns null for agent without plan", async () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    // Register agent without setting plan
    const reg2 = await db.register("no-plan-agent");
    if (!reg2.ok) {throw new Error("expected ok");}
    const agent2 = reg2.value;

    const result = await db.getPlan(agent2.agentName);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const plan = result.value;
    assert.strictEqual(plan, null);
  });

  it("listPlans returns all plans", async () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    await db.updatePlan(agentName, agentKey, "Goal 1", "Task 1");

    // Register second agent with plan
    const reg2 = await db.register("plan-agent-2");
    if (!reg2.ok) {throw new Error("expected ok");}
    const agent2 = reg2.value;
    await db.updatePlan(agent2.agentName, agent2.agentKey, "Goal 2", "Task 2");

    const result = await db.listPlans();
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const plans = result.value;
    assert.strictEqual(plans.length, 2);
    assert.deepStrictEqual(
      new Set(plans.map((p) => p.goal)),
      new Set(["Goal 1", "Goal 2"]),
    );
  });

  it("plan updatedAt changes on update", async () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    await db.updatePlan(agentName, agentKey, "Goal", "Task 1");
    const getPlan1 = await db.getPlan(agentName);
    if (!getPlan1.ok) {throw new Error("expected ok");}
    const plan1 = getPlan1.value;

    await db.updatePlan(agentName, agentKey, "Goal", "Task 2");
    const getPlan2 = await db.getPlan(agentName);
    if (!getPlan2.ok) {throw new Error("expected ok");}
    const plan2 = getPlan2.value;

    assert.ok(plan2!.updatedAt >= plan1!.updatedAt);
  });
});
