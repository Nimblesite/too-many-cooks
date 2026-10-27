/// Tests for NotificationEmitter with push callbacks and AgentEventHub.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  type AgentEventHub,
  createNotificationEmitter,
  createAgentEventHub,
  sendNotification,
  BROADCAST_RECIPIENT,
  EVENT_AGENT_REGISTERED,
  EVENT_LOCK_ACQUIRED,
  EVENT_MESSAGE_SENT,
} from "too-many-cooks-core";

import { createEventRecorder, createTestMcpServer } from "./support/handlers.js";

/** A `[sessionId, agentName]` binding to install on a hub. */
type SessionBinding = readonly [string, string];

/** Binds `sessionId` to a fresh test server and agent name on `hub`. */
const bindHubSession = (
  hub: AgentEventHub,
  sessionId: string,
  agentName: string,
): void => {
  hub.servers.set(sessionId, createTestMcpServer());
  hub.sessionAgentNames.set(sessionId, agentName);
};

/** Asserts both hub maps hold exactly `count` entries. */
const assertHubSize = (hub: AgentEventHub, count: number): void => {
  assert.strictEqual(hub.servers.size, count);
  assert.strictEqual(hub.sessionAgentNames.size, count);
};

/** Binds `sessions` onto `hub` and asserts the resulting map sizes. */
const bindSessions = (
  hub: AgentEventHub,
  sessions: readonly SessionBinding[],
): void => {
  for (const [sessionId, agentName] of sessions) {
    bindHubSession(hub, sessionId, agentName);
  }
  assertHubSize(hub, sessions.length);
};

/** Asserts every bound session is still registered on `hub`, unchanged. */
const assertSessionsPreserved = (
  hub: AgentEventHub,
  sessions: readonly SessionBinding[],
): void => {
  assertHubSize(hub, sessions.length);
  for (const [sessionId, agentName] of sessions) {
    assert.strictEqual(hub.servers.has(sessionId), true);
    assert.strictEqual(hub.sessionAgentNames.has(sessionId), true);
    assert.strictEqual(hub.sessionAgentNames.get(sessionId), agentName);
  }
};

/** Builds a hub with `sessions` bound and no active streams. */
const hubWithSessions = (
  sessions: readonly SessionBinding[],
): AgentEventHub => {
  const hub = createAgentEventHub();
  bindSessions(hub, sessions);
  assert.strictEqual(hub.activeStreamSessions.size, 0);
  return hub;
};

describe("NotificationEmitter with callbacks", () => {
  it("emit calls both adminPush and agentPush", () => {
    const { adminEvents, agentEvents, adminPush, agentPush } = createEventRecorder();

    const emitter = createNotificationEmitter(createTestMcpServer(), adminPush, agentPush);
    emitter.emit(EVENT_AGENT_REGISTERED, { agent_name: "test" });

    assert.strictEqual(adminEvents.length, 1);
    assert.strictEqual(adminEvents[0], EVENT_AGENT_REGISTERED);
    assert.strictEqual(agentEvents.length, 1);
    assert.strictEqual(agentEvents[0], EVENT_AGENT_REGISTERED);
  });

  it("emitAdmin calls only adminPush", () => {
    const { adminEvents, agentEvents, adminPush, agentPush } = createEventRecorder();

    const emitter = createNotificationEmitter(createTestMcpServer(), adminPush, agentPush);
    emitter.emitAdmin(EVENT_LOCK_ACQUIRED, { file: "/test.ts" });

    assert.strictEqual(adminEvents.length, 1);
    assert.strictEqual(agentEvents.length, 0);
  });

  it("emitToAgent calls adminPush and agentPushToAgent", () => {
    const adminEvents: string[] = [];
    const targetedEvents: Array<{ event: string; toAgent: string }> = [];
    const adminPush = (event: string): void => { adminEvents.push(event); };
    const agentPushToAgent = (event: string, _payload: Record<string, unknown>, toAgent: string): void => {
      targetedEvents.push({ event, toAgent });
    };

    const emitter = createNotificationEmitter(createTestMcpServer(), adminPush, undefined, agentPushToAgent);
    emitter.emitToAgent(EVENT_MESSAGE_SENT, { content: "hello" }, "agent-2");

    assert.strictEqual(adminEvents.length, 1);
    assert.strictEqual(targetedEvents.length, 1);
    const targeted = targetedEvents[0];
    assert.ok(targeted !== undefined, "targeted event must exist");
    assert.strictEqual(targeted.toAgent, "agent-2");
  });

  it("works with no callbacks (all undefined)", () => {
    const emitter = createNotificationEmitter(createTestMcpServer());
    // Should not throw
    emitter.emit(EVENT_AGENT_REGISTERED, {});
    emitter.emitAdmin(EVENT_LOCK_ACQUIRED, {});
    emitter.emitToAgent(EVENT_MESSAGE_SENT, {}, "agent");
  });
});

describe("AgentEventHub", () => {
  it("creates with empty maps and sets", () => {
    const hub = createAgentEventHub();
    assert.strictEqual(hub.servers.size, 0);
    assert.strictEqual(hub.sessionAgentNames.size, 0);
    assert.strictEqual(hub.activeStreamSessions.size, 0);
  });

  it("pushEvent does nothing with no servers", () => {
    const hub = createAgentEventHub();
    // Should not throw
    hub.pushEvent(EVENT_AGENT_REGISTERED, { agent_name: "test" });
  });

  it("pushToAgent does nothing with no servers", () => {
    const hub = createAgentEventHub();
    // Should not throw
    hub.pushToAgent(EVENT_MESSAGE_SENT, { content: "hello" }, "agent-1");
  });

  it("pushToAgent broadcast does nothing with no servers", () => {
    const hub = createAgentEventHub();
    // Should not throw
    hub.pushToAgent(EVENT_MESSAGE_SENT, { content: "hello" }, BROADCAST_RECIPIENT);
  });

  it("pushToAgent to agent WITHOUT active stream does not throw", () => {
    const sessions: readonly SessionBinding[] = [["session-no-stream", "offline-agent"]];
    // Register the agent's server and name mapping, but do NOT add to activeStreamSessions
    const hub = hubWithSessions(sessions);

    // Push to agent — MUST NOT throw even though agent has no active stream
    hub.pushToAgent(EVENT_MESSAGE_SENT, { content: "hello offline" }, "offline-agent");

    // Session MUST still exist after failed notification (not cleaned up)
    assertSessionsPreserved(hub, sessions);
  });

  it("pushEvent broadcast to agents WITHOUT active stream does not throw", () => {
    const sessions: readonly SessionBinding[] = [["session-broadcast-no-stream", "broadcast-target"]];
    const hub = hubWithSessions(sessions);

    // Broadcast — MUST NOT throw
    hub.pushEvent(EVENT_AGENT_REGISTERED, { agent_name: "new-agent" });

    // Session MUST still exist
    assertSessionsPreserved(hub, sessions);
  });

  it("pushToAgent broadcast to multiple agents WITHOUT active stream does not throw", () => {
    const sessions: readonly SessionBinding[] = [
      ["sess-1", "agent-a"],
      ["sess-2", "agent-b"],
      ["sess-3", "agent-c"],
    ];
    const hub = hubWithSessions(sessions);

    // Broadcast to all — MUST NOT throw
    hub.pushToAgent(EVENT_MESSAGE_SENT, { content: "broadcast" }, BROADCAST_RECIPIENT);

    // ALL sessions MUST still exist
    assertSessionsPreserved(hub, sessions);
  });

  it("pushToAgent targeted to specific agent preserves other sessions", () => {
    const sessions: readonly SessionBinding[] = [
      ["sess-target", "target-agent"],
      ["sess-other", "other-agent"],
    ];
    const hub = hubWithSessions(sessions);

    // Send only to target-agent — MUST NOT throw
    hub.pushToAgent(EVENT_MESSAGE_SENT, { content: "direct msg" }, "target-agent");

    // BOTH sessions MUST still exist
    assertSessionsPreserved(hub, sessions);
  });

  it("pushToAgent to nonexistent agent does not throw or corrupt state", () => {
    const sessions: readonly SessionBinding[] = [["sess-existing", "existing-agent"]];
    const hub = hubWithSessions(sessions);

    // Send to an agent that doesn't exist — MUST NOT throw
    hub.pushToAgent(EVENT_MESSAGE_SENT, { content: "hello ghost" }, "nonexistent-agent");

    // Existing session MUST be untouched
    assertSessionsPreserved(hub, sessions);
  });
});

describe("sendNotification", () => {
  it("returns error when server has no transport", async () => {
    const server = createTestMcpServer();
    const result = await sendNotification(server, { test: "data" });
    // Should return error since server has no connected transport
    assert.strictEqual(result.ok, false);
  });
});
