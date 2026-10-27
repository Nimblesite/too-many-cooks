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
import { assertArrayFieldCount } from "./support/assertions.js";

const TEST_DB_PATH = ".test_status_handler.db";

/** Expected agent/lock/plan counts plus message-overview counts. */
type StatusCounts = {
  readonly agents: number;
  readonly locks: number;
  readonly plans: number;
  readonly total: number;
  readonly unread: number;
  readonly recent: number;
};

describe("status handler", () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  /** Runs the status handler with `args` and asserts every count. */
  const assertStatusCounts = async (
    args: Record<string, unknown>,
    expected: StatusCounts,
  ): Promise<void> => {
    const handler = createStatusHandler(testDb.db(), createTestLogger());
    const result = await handler(args, {});
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assertArrayFieldCount(parsed, "agents", expected.agents);
    assertArrayFieldCount(parsed, "locks", expected.locks);
    assertArrayFieldCount(parsed, "plans", expected.plans);
    // [STATUS-BOUNDED] Issues #41/#42: messages is a bounded overview, not a flat array.
    const messages = statusMessagesOverview(result);
    assert.strictEqual(messages.total, expected.total);
    assert.strictEqual(messages.unread, expected.unread);
    assert.strictEqual(Array.isArray(messages.recent), true);
    assert.strictEqual(messages.recent.length, expected.recent);
  };

  it("returns empty status for fresh db", async () => {
    await assertStatusCounts({}, { agents: 0, locks: 0, plans: 0, total: 0, unread: 0, recent: 0 });
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

    // [MSG-PRIVACY] Issue #11: the direct message (reg1 -> reg2) is only visible
    // to its recipient, so query status as reg2 to see it.
    // [STATUS-BOUNDED] Issues #41/#42: the reg1 -> reg2 direct message is one
    // unread header in reg2's bounded overview.
    await assertStatusCounts(
      { agent_key: agent2.agentKey },
      { agents: 2, locks: 1, plans: 1, total: 1, unread: 1, recent: 1 },
    );
  });
});
