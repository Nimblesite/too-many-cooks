/// Tests for NotificationEmitter with push callbacks and AgentEventHub.

import { describe, it } from "node:test";
import assert from "node:assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createNotificationEmitter,
  createAgentEventHub,
  sendNotification,
  BROADCAST_RECIPIENT,
  EVENT_AGENT_REGISTERED,
  EVENT_LOCK_ACQUIRED,
  EVENT_MESSAGE_SENT,
} from "@too-many-cooks/core";

const createServer = () =>
  new McpServer(
    { name: "test", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false }, logging: {} } },
  );

describe("NotificationEmitter with callbacks", () => {
  it("emit calls both adminPush and agentPush", () => {
    const adminEvents: string[] = [];
    const agentEvents: string[] = [];
    const adminPush = (event: string): void => { adminEvents.push(event); };
    const agentPush = (event: string): void => { agentEvents.push(event); };

    const emitter = createNotificationEmitter(createServer(), adminPush, agentPush);
    emitter.emit(EVENT_AGENT_REGISTERED, { agent_name: "test" });

    assert.strictEqual(adminEvents.length, 1);
    assert.strictEqual(adminEvents[0], EVENT_AGENT_REGISTERED);
    assert.strictEqual(agentEvents.length, 1);
    assert.strictEqual(agentEvents[0], EVENT_AGENT_REGISTERED);
  });

  it("emitAdmin calls only adminPush", () => {
    const adminEvents: string[] = [];
    const agentEvents: string[] = [];
    const adminPush = (event: string): void => { adminEvents.push(event); };
    const agentPush = (event: string): void => { agentEvents.push(event); };

    const emitter = createNotificationEmitter(createServer(), adminPush, agentPush);
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

    const emitter = createNotificationEmitter(createServer(), adminPush, undefined, agentPushToAgent);
    emitter.emitToAgent(EVENT_MESSAGE_SENT, { content: "hello" }, "agent-2");

    assert.strictEqual(adminEvents.length, 1);
    assert.strictEqual(targetedEvents.length, 1);
    assert.strictEqual(targetedEvents[0].toAgent, "agent-2");
  });

  it("works with no callbacks (all undefined)", () => {
    const emitter = createNotificationEmitter(createServer());
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
    const hub = createAgentEventHub();
    const server = createServer();
    const sessionId = "session-no-stream";
    const agentName = "offline-agent";

    // Register the agent's server and name mapping, but do NOT add to activeStreamSessions
    hub.servers.set(sessionId, server);
    hub.sessionAgentNames.set(sessionId, agentName);

    assert.strictEqual(hub.servers.size, 1);
    assert.strictEqual(hub.sessionAgentNames.size, 1);
    assert.strictEqual(hub.activeStreamSessions.size, 0);

    // Push to agent — MUST NOT throw even though agent has no active stream
    hub.pushToAgent(EVENT_MESSAGE_SENT, { content: "hello offline" }, agentName);

    // Session MUST still exist after failed notification (not cleaned up)
    assert.strictEqual(hub.servers.has(sessionId), true);
    assert.strictEqual(hub.sessionAgentNames.has(sessionId), true);
    assert.strictEqual(hub.servers.size, 1);
    assert.strictEqual(hub.sessionAgentNames.size, 1);
  });

  it("pushEvent broadcast to agents WITHOUT active stream does not throw", () => {
    const hub = createAgentEventHub();
    const server = createServer();
    const sessionId = "session-broadcast-no-stream";

    hub.servers.set(sessionId, server);
    hub.sessionAgentNames.set(sessionId, "broadcast-target");

    assert.strictEqual(hub.activeStreamSessions.size, 0);

    // Broadcast — MUST NOT throw
    hub.pushEvent(EVENT_AGENT_REGISTERED, { agent_name: "new-agent" });

    // Session MUST still exist
    assert.strictEqual(hub.servers.has(sessionId), true);
    assert.strictEqual(hub.sessionAgentNames.has(sessionId), true);
    assert.strictEqual(hub.servers.size, 1);
    assert.strictEqual(hub.sessionAgentNames.size, 1);
  });

  it("pushToAgent broadcast to multiple agents WITHOUT active stream does not throw", () => {
    const hub = createAgentEventHub();
    const server1 = createServer();
    const server2 = createServer();
    const server3 = createServer();

    hub.servers.set("sess-1", server1);
    hub.servers.set("sess-2", server2);
    hub.servers.set("sess-3", server3);
    hub.sessionAgentNames.set("sess-1", "agent-a");
    hub.sessionAgentNames.set("sess-2", "agent-b");
    hub.sessionAgentNames.set("sess-3", "agent-c");

    assert.strictEqual(hub.servers.size, 3);
    assert.strictEqual(hub.sessionAgentNames.size, 3);
    assert.strictEqual(hub.activeStreamSessions.size, 0);

    // Broadcast to all — MUST NOT throw
    hub.pushToAgent(EVENT_MESSAGE_SENT, { content: "broadcast" }, BROADCAST_RECIPIENT);

    // ALL sessions MUST still exist
    assert.strictEqual(hub.servers.size, 3);
    assert.strictEqual(hub.sessionAgentNames.size, 3);
    assert.strictEqual(hub.servers.has("sess-1"), true);
    assert.strictEqual(hub.servers.has("sess-2"), true);
    assert.strictEqual(hub.servers.has("sess-3"), true);
    assert.strictEqual(hub.sessionAgentNames.has("sess-1"), true);
    assert.strictEqual(hub.sessionAgentNames.has("sess-2"), true);
    assert.strictEqual(hub.sessionAgentNames.has("sess-3"), true);
  });

  it("pushToAgent targeted to specific agent preserves other sessions", () => {
    const hub = createAgentEventHub();
    const server1 = createServer();
    const server2 = createServer();

    hub.servers.set("sess-target", server1);
    hub.servers.set("sess-other", server2);
    hub.sessionAgentNames.set("sess-target", "target-agent");
    hub.sessionAgentNames.set("sess-other", "other-agent");

    assert.strictEqual(hub.servers.size, 2);
    assert.strictEqual(hub.sessionAgentNames.size, 2);

    // Send only to target-agent — MUST NOT throw
    hub.pushToAgent(EVENT_MESSAGE_SENT, { content: "direct msg" }, "target-agent");

    // BOTH sessions MUST still exist
    assert.strictEqual(hub.servers.size, 2);
    assert.strictEqual(hub.sessionAgentNames.size, 2);
    assert.strictEqual(hub.servers.has("sess-target"), true);
    assert.strictEqual(hub.servers.has("sess-other"), true);
    assert.strictEqual(hub.sessionAgentNames.get("sess-target"), "target-agent");
    assert.strictEqual(hub.sessionAgentNames.get("sess-other"), "other-agent");
  });

  it("pushToAgent to nonexistent agent does not throw or corrupt state", () => {
    const hub = createAgentEventHub();
    const server = createServer();

    hub.servers.set("sess-existing", server);
    hub.sessionAgentNames.set("sess-existing", "existing-agent");

    assert.strictEqual(hub.servers.size, 1);
    assert.strictEqual(hub.sessionAgentNames.size, 1);

    // Send to an agent that doesn't exist — MUST NOT throw
    hub.pushToAgent(EVENT_MESSAGE_SENT, { content: "hello ghost" }, "nonexistent-agent");

    // Existing session MUST be untouched
    assert.strictEqual(hub.servers.size, 1);
    assert.strictEqual(hub.sessionAgentNames.size, 1);
    assert.strictEqual(hub.servers.has("sess-existing"), true);
    assert.strictEqual(hub.sessionAgentNames.get("sess-existing"), "existing-agent");
  });
});

describe("sendNotification", () => {
  it("returns error when server has no transport", async () => {
    const server = createServer();
    const result = await sendNotification(server, { test: "data" });
    // Should return error since server has no connected transport
    assert.strictEqual(result.ok, false);
  });
});
