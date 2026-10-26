/// Tests for status tool handler (direct import, not via spawned server).

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createStatusHandler,
} from "too-many-cooks-core";
import { bindTestDb, registerAgent } from "./support/db_fixture.js";
import {
  createTestLogger,
  parseToolJson,
  statusMessagesOverview,
} from "./support/handlers.js";
import { getArrayField } from "./support/json.js";

const TEST_DB_PATH = ".test_status_handler.db";

describe("status handler", () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  it("returns empty status for fresh db", async () => {
    const db = testDb.db();
    const handler = createStatusHandler(db, createTestLogger());
    const result = await handler({}, {});
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(Array.isArray(parsed.agents), true);
    assert.strictEqual(Array.isArray(parsed.locks), true);
    assert.strictEqual(Array.isArray(parsed.plans), true);
    assert.strictEqual(getArrayField(parsed, "agents").length, 0);
    assert.strictEqual(getArrayField(parsed, "locks").length, 0);
    // [STATUS-BOUNDED] Issues #41/#42: messages is a bounded overview, not a flat array.
    const messages = statusMessagesOverview(result);
    assert.strictEqual(messages.total, 0);
    assert.strictEqual(messages.unread, 0);
    assert.strictEqual(Array.isArray(messages.recent), true);
    assert.strictEqual(messages.recent.length, 0);
  });

  it("returns populated status after registrations and actions", async () => {
    const db = testDb.db();
    // Register agents
    const agent1 = await registerAgent(db, "status-agent-1");
    const agent2 = await registerAgent(db, "status-agent-2");

    // Create some locks
    await db.acquireLock("/status/file.ts", agent1.agentName, agent1.agentKey, "testing", 60000);

    // Create plans
    await db.updatePlan(agent1.agentName, agent1.agentKey, "Goal 1", "Task 1");

    // Send messages
    await db.sendMessage(agent1.agentName, agent1.agentKey, agent2.agentName, "hello");

    const handler = createStatusHandler(db, createTestLogger());
    // [MSG-PRIVACY] Issue #11: the direct message (reg1 -> reg2) is only visible
    // to its recipient, so query status as reg2 to see it.
    const result = await handler({ agent_key: agent2.agentKey }, {});
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(getArrayField(parsed, "agents").length, 2);
    assert.strictEqual(getArrayField(parsed, "locks").length, 1);
    assert.strictEqual(getArrayField(parsed, "plans").length, 1);
    // [STATUS-BOUNDED] Issues #41/#42: the reg1 -> reg2 direct message is one
    // unread header in reg2's bounded overview.
    const messages = statusMessagesOverview(result);
    assert.strictEqual(messages.total, 1);
    assert.strictEqual(messages.unread, 1);
    assert.strictEqual(messages.recent.length, 1);
  });
});
