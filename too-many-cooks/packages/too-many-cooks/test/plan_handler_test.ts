/// Tests for plan tool handler (direct import, not via spawned server).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import type { SessionIdentity, TooManyCooksDb } from "too-many-cooks-core";
import {
  freshTestDb,
  registerAgent,
  requireDb,
  teardownTestDb,
} from "./support/db_fixture.js";
import { planHandlerFor, runToolErr, runToolOk } from "./support/handlers.js";
import { getArrayField, getRecordField } from "./support/json.js";

const TEST_DB_PATH = ".test_plan_handler.db";

describe("plan handler", () => {
  let db: TooManyCooksDb | undefined;
  let agentName = "";
  let agentKey = "";

  beforeEach(async () => {
    const fixture = freshTestDb(TEST_DB_PATH);
    db = fixture.db;

    const agent = await registerAgent(db, "plan-agent");
    agentName = agent.agentName;
    agentKey = agent.agentKey;
  });

  afterEach(() => {
    teardownTestDb(db, TEST_DB_PATH);
  });

  const makeSession = (): (() => SessionIdentity) =>
    () => ({ agentName, agentKey });

  it("update succeeds with goal and current_task", async () => {
    const d = requireDb(db);
    const parsed = await runToolOk(
      planHandlerFor(d, makeSession()),
      { action: "update", goal: "Fix bugs", current_task: "Reading code" },
    );
    assert.strictEqual(parsed.updated, true);
  });

  it("get returns plan after update", async () => {
    const d = requireDb(db);
    const handler = planHandlerFor(d, makeSession());
    await handler({ action: "update", goal: "Ship feature", current_task: "Writing tests" }, {});
    const parsed = await runToolOk(handler, { action: "get" });
    const plan = getRecordField(parsed, "plan");
    assert.strictEqual(plan.goal, "Ship feature");
    assert.strictEqual(plan.current_task, "Writing tests");
  });

  it("get returns null when no plan", async () => {
    const d = requireDb(db);
    const parsed = await runToolOk(planHandlerFor(d, makeSession()), { action: "get" });
    assert.strictEqual(parsed.plan, null);
  });

  it("list returns all plans", async () => {
    const d = requireDb(db);
    const handler = planHandlerFor(d, makeSession());
    await handler({ action: "update", goal: "Goal A", current_task: "Task A" }, {});

    // Register second agent and set plan
    const agent2 = await registerAgent(d, "plan-agent-2");
    const getSession2 = (): SessionIdentity => ({
      agentName: agent2.agentName,
      agentKey: agent2.agentKey,
    });
    const handler2 = planHandlerFor(d, getSession2);
    await handler2({ action: "update", goal: "Goal B", current_task: "Task B" }, {});

    const parsed = await runToolOk(handler, { action: "list" });
    assert.strictEqual(Array.isArray(parsed.plans), true);
    assert.strictEqual(getArrayField(parsed, "plans").length, 2);
  });

  it("fails when action is missing", async () => {
    const d = requireDb(db);
    await runToolErr(planHandlerFor(d, makeSession()), {});
  });

  it("fails with unknown action", async () => {
    const d = requireDb(db);
    await runToolErr(planHandlerFor(d, makeSession()), { action: "delete" });
  });

  it("update fails without goal", async () => {
    const d = requireDb(db);
    await runToolErr(planHandlerFor(d, makeSession()), { action: "update", current_task: "stuff" });
  });

  it("update fails without current_task", async () => {
    const d = requireDb(db);
    await runToolErr(planHandlerFor(d, makeSession()), { action: "update", goal: "stuff" });
  });

  it("fails when not registered and no session", async () => {
    const d = requireDb(db);
    const getSession = (): SessionIdentity | null => null;
    await runToolErr(planHandlerFor(d, getSession), { action: "update", goal: "g", current_task: "t" });
  });

  it("works with agent_key override", async () => {
    const d = requireDb(db);
    const getSession = (): SessionIdentity | null => null;
    const parsed = await runToolOk(
      planHandlerFor(d, getSession),
      { action: "update", goal: "via key", current_task: "testing", agent_key: agentKey },
    );
    assert.strictEqual(parsed.updated, true);
  });

  it("list works without registration", async () => {
    const d = requireDb(db);
    const getSession = (): SessionIdentity | null => null;
    await runToolOk(planHandlerFor(d, getSession), { action: "list" });
  });
});
