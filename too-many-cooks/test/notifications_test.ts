/// Tests for notifications - NotificationEmitter.

import { describe, it } from "node:test";
import assert from "node:assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createNotificationEmitter,
  EVENT_AGENT_REGISTERED,
  EVENT_LOCK_ACQUIRED,
  EVENT_AGENT_ACTIVATED,
  EVENT_AGENT_DEACTIVATED,
  EVENT_LOCK_RELEASED,
  EVENT_LOCK_RENEWED,
  EVENT_MESSAGE_SENT,
  EVENT_PLAN_UPDATED,
} from "../lib/src/notifications.js";

const createEmitter = () => {
  const server = new McpServer(
    { name: "test", version: "1.0.0" },
    {
      capabilities: {
        tools: { listChanged: false },
        logging: {},
      },
    },
  );
  return createNotificationEmitter(server);
};

describe("NotificationEmitter", () => {
  it("emit does nothing without throwing", () => {
    const emitter = createEmitter();
    // Should not throw
    emitter.emit(EVENT_AGENT_REGISTERED, { test: "data" });
  });

  it("emit with various event types does not throw", () => {
    const emitter = createEmitter();
    emitter.emit(EVENT_LOCK_ACQUIRED, { file: "/test.dart" });
    emitter.emit(EVENT_AGENT_ACTIVATED, { agent_name: "test" });
    emitter.emit(EVENT_AGENT_DEACTIVATED, { agent_name: "test" });
    emitter.emit(EVENT_PLAN_UPDATED, { plan: "test" });
  });
});

describe("Event constants", () => {
  it("event constants have correct values", () => {
    assert.strictEqual(EVENT_AGENT_REGISTERED, "agent_registered");
    assert.strictEqual(EVENT_AGENT_ACTIVATED, "agent_activated");
    assert.strictEqual(EVENT_AGENT_DEACTIVATED, "agent_deactivated");
    assert.strictEqual(EVENT_LOCK_ACQUIRED, "lock_acquired");
    assert.strictEqual(EVENT_LOCK_RELEASED, "lock_released");
    assert.strictEqual(EVENT_LOCK_RENEWED, "lock_renewed");
    assert.strictEqual(EVENT_MESSAGE_SENT, "message_sent");
    assert.strictEqual(EVENT_PLAN_UPDATED, "plan_updated");
  });
});
