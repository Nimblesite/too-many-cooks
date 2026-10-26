/// E2E streaming test - spawn MCP server, open Streamable HTTP
/// stream on /admin/events, trigger state changes via tool calls,
/// ASSERT that events arrive over the stream.
///
/// This is the PROOF that Streamable HTTP push works end-to-end.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import type { ChildProcess } from "node:child_process";

import {
  type SpawnedServer,
  killServer,
  resetServerViaAdmin,
  spawnServer,
  waitForServer,
} from "./support/server_process.js";
import {
  ACCEPT_STREAMABLE,
  ADMIN_EVENTS_PATH,
  McpHttpClient,
  initAdminEventsSession,
  type ClientInfo,
} from "./support/mcp_http.js";
import { SseEventCollector, extractEventType, parseJsonRecord } from "./support/sse.js";
import { removeTree } from "./support/fs_helpers.js";
import { getStringField, isRecord } from "./support/json.js";

const TEST_PORT = 4043;
const BASE_URL = `http://localhost:${String(TEST_PORT)}`;
const EVENT_TIMEOUT_MS = 1000;
const TMP_PREFIX = "/tmp/tmc-streaming-e2e-";

const ADMIN_CLIENT_INFO: ClientInfo = { name: "streaming-e2e-test", version: "1.0.0" };
const MCP_CLIENT_INFO: ClientInfo = { name: "streaming-e2e-mcp", version: "1.0.0" };

// ============================================================
// Helpers
// ============================================================

/** Opens the admin GET /admin/events notification stream. */
const connectAdminStream = async (): Promise<SseEventCollector> => {
  const sessionId = await initAdminEventsSession(BASE_URL, ADMIN_CLIENT_INFO);
  return SseEventCollector.open({
    url: `${BASE_URL}${ADMIN_EVENTS_PATH}`,
    headers: { Accept: ACCEPT_STREAMABLE, "mcp-session-id": sessionId },
  });
};

/** Waits for events with this suite's shorter timeout budget. */
const waitForEvents = async (
  stream: SseEventCollector,
  count: number,
): Promise<string[]> => stream.waitForEvents(count, EVENT_TIMEOUT_MS);

const newMcpClient = (): McpHttpClient =>
  new McpHttpClient({ baseUrl: BASE_URL, clientInfo: MCP_CLIENT_INFO });

const adminPost = async (
  path: string,
  body: Record<string, unknown>,
): Promise<void> => {
  await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

let spawned: SpawnedServer | undefined;

// ============================================================
// Tests
// ============================================================

describe("Streaming E2E - Events Over Streamable HTTP", () => {
  let serverProcess: ChildProcess;
  let mcpClient: McpHttpClient;

  before(async () => {
    spawned = spawnServer({ port: TEST_PORT, tmpPrefix: TMP_PREFIX });
    serverProcess = spawned.proc;
    await waitForServer(BASE_URL);
  });

  after(() => {
    killServer(serverProcess);
    if (spawned !== undefined) {
      removeTree(spawned.workspace);
    }
  });

  beforeEach(async () => {
    await resetServerViaAdmin(BASE_URL);
    mcpClient = newMcpClient();
    await mcpClient.initSession();
  });

  it("admin stream receives event when agent registers", async () => {
    // 1. Open admin stream
    const stream = await connectAdminStream();

    // 2. Register agent via MCP tool call
    const regResult = await mcpClient.callTool("register", {
      name: "stream-agent-1",
    });
    const regJson = parseJsonRecord(regResult);
    assert.strictEqual(regJson.agent_name, "stream-agent-1");

    // 3. ASSERT: stream event arrives
    const events = await waitForEvents(stream, 1);
    stream.close();

    assert.ok(
      events.length >= 1,
      "MUST receive at least 1 stream event after register",
    );
    // Verify event contains notification data
    const firstEvent = events[0];
    assert.ok(firstEvent !== undefined);
    assert.ok(
      firstEvent.includes("notifications/message"),
      "Stream event MUST be an MCP logging notification",
    );
  });

  it("admin stream receives events for ALL tool operations", async () => {
    const stream = await connectAdminStream();

    // Register 2 agents
    const reg1 = parseJsonRecord(
      await mcpClient.callTool("register", { name: "stream-all-1" }),
    );
    const key1 = getStringField(reg1, "agent_key");

    parseJsonRecord(
      await mcpClient.callTool("register", { name: "stream-all-2" }),
    );

    // Wait for register events
    const regEvents = await waitForEvents(stream, 2);
    assert.ok(
      regEvents.length >= 2,
      "MUST get events for both registrations",
    );

    // Acquire lock
    await mcpClient.callTool("lock", {
      action: "acquire",
      file_path: "/stream/e2e.dart",
      agent_key: key1,
      reason: "e2e test",
    });

    // Wait for lock event
    const lockEvents = await waitForEvents(stream, 1);
    assert.ok(lockEvents.length > 0, "MUST get stream event for lock acquire");

    // Update plan
    await mcpClient.callTool("plan", {
      action: "update",
      agent_key: key1,
      goal: "Stream e2e goal",
      current_task: "Testing streaming",
    });

    // Wait for plan event
    const planEvents = await waitForEvents(stream, 1);
    assert.ok(planEvents.length > 0, "MUST get stream event for plan update");

    // Send message
    await mcpClient.callTool("message", {
      action: "send",
      agent_key: key1,
      to_agent: "stream-all-2",
      content: "streaming e2e test message",
    });

    // Wait for message event
    const msgEvents = await waitForEvents(stream, 1);
    assert.ok(msgEvents.length > 0, "MUST get stream event for message send");

    // Release lock
    await mcpClient.callTool("lock", {
      action: "release",
      file_path: "/stream/e2e.dart",
      agent_key: key1,
    });

    // Wait for release event
    const releaseEvents = await waitForEvents(stream, 1);
    assert.ok(
      releaseEvents.length > 0,
      "MUST get stream event for lock release",
    );

    stream.close();
  });

  it("stream events contain correct payload structure", async () => {
    const stream = await connectAdminStream();

    // Register agent
    await mcpClient.callTool("register", { name: "payload-check" });

    const events = await waitForEvents(stream, 1);
    stream.close();

    assert.ok(events.length > 0);

    // Parse the stream data as JSON-RPC notification
    const eventJson = parseJsonRecord(events[0] ?? "");
    assert.strictEqual(eventJson.jsonrpc, "2.0");
    assert.strictEqual(eventJson.method, "notifications/message");

    // Params must contain logging data
    const params = eventJson.params;
    assert.ok(isRecord(params), "params must be a record");
    assert.strictEqual(params.level, "info");

    // Data must contain event and payload
    const data = params.data;
    assert.ok(isRecord(data), "data must be a record");
    assert.ok("event" in data);
    assert.ok("payload" in data);
    assert.ok("timestamp" in data);
    assert.strictEqual(
      data.event,
      "agent_registered",
      "Event type MUST be agent_registered for register",
    );
  });

  it("multiple stream clients each receive all events", async () => {
    // Open 2 independent streams
    const stream1 = await connectAdminStream();
    const stream2 = await connectAdminStream();

    // Register agent
    await mcpClient.callTool("register", { name: "multi-stream-test" });

    // Both clients MUST receive the event
    const events1 = await waitForEvents(stream1, 1);
    const events2 = await waitForEvents(stream2, 1);

    stream1.close();
    stream2.close();

    assert.ok(events1.length > 0, "Stream client 1 MUST receive event");
    assert.ok(events2.length > 0, "Stream client 2 MUST receive event");
  });

  it("stream delivers events for concurrent tool calls", async () => {
    const stream = await connectAdminStream();

    // Register 5 agents concurrently
    const agentCount = 5;
    const regPromises = Array.from({ length: agentCount }, async (_, i) =>
      mcpClient.callTool("register", { name: `concurrent-${String(i)}` }),
    );
    await Promise.all(regPromises);

    // MUST receive events for all 5 registrations
    const events = await waitForEvents(stream, agentCount);
    stream.close();

    assert.ok(
      events.length >= agentCount,
      `MUST receive ${String(agentCount)} events for ` +
        `${String(agentCount)} concurrent registrations`,
    );
  });

  it("admin REST push delivers events to stream", async () => {
    // Register via MCP first so agents exist
    const reg = parseJsonRecord(
      await mcpClient.callTool("register", {
        name: "admin-push-agent",
      }),
    );

    const stream = await connectAdminStream();

    // Use admin REST to send message (bypasses MCP)
    await adminPost("/admin/send-message", {
      fromAgent: reg.agent_name,
      toAgent: "*",
      content: "Admin push test",
    });

    // Stream MUST receive the event
    const events = await waitForEvents(stream, 1);
    stream.close();

    assert.ok(
      events.length > 0,
      "Admin REST push MUST deliver events to stream",
    );
  });

  it("full round trip: register, lock, plan, message all stream as events", async () => {
    const stream = await connectAdminStream();
    const allEvents: string[] = [];

    // Register
    const reg = parseJsonRecord(
      await mcpClient.callTool("register", {
        name: "roundtrip-agent",
      }),
    );
    const key = getStringField(reg, "agent_key");
    allEvents.push(...(await waitForEvents(stream, 1)));

    // Lock
    await mcpClient.callTool("lock", {
      action: "acquire",
      file_path: "/roundtrip/test.dart",
      agent_key: key,
      reason: "roundtrip",
    });
    allEvents.push(...(await waitForEvents(stream, 1)));

    // Plan
    await mcpClient.callTool("plan", {
      action: "update",
      agent_key: key,
      goal: "Roundtrip goal",
      current_task: "Roundtrip task",
    });
    allEvents.push(...(await waitForEvents(stream, 1)));

    // Message
    await mcpClient.callTool("message", {
      action: "send",
      agent_key: key,
      to_agent: "*",
      content: "Roundtrip broadcast",
    });
    allEvents.push(...(await waitForEvents(stream, 1)));

    // Release lock
    await mcpClient.callTool("lock", {
      action: "release",
      file_path: "/roundtrip/test.dart",
      agent_key: key,
    });
    allEvents.push(...(await waitForEvents(stream, 1)));

    stream.close();

    // MUST have received events for all operations
    assert.ok(
      allEvents.length >= 5,
      "MUST receive at least 5 stream events for " +
        "register+lock+plan+message+release",
    );

    // Extract event types from all events
    const eventTypes = allEvents.map((e) => extractEventType(e));

    assert.ok(
      eventTypes.includes("agent_registered"),
      "MUST have agent_registered event",
    );
    assert.ok(
      eventTypes.includes("lock_acquired"),
      "MUST have lock_acquired event",
    );
    assert.ok(
      eventTypes.includes("plan_updated"),
      "MUST have plan_updated event",
    );
    assert.ok(
      eventTypes.includes("message_sent"),
      "MUST have message_sent event",
    );
    assert.ok(
      eventTypes.includes("lock_released"),
      "MUST have lock_released event",
    );
  });
});
