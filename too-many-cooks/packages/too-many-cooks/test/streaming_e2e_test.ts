/// E2E streaming test - spawn MCP server, open Streamable HTTP
/// stream on /admin/events, trigger state changes via tool calls,
/// ASSERT that events arrive over the stream.
///
/// This is the PROOF that Streamable HTTP push works end-to-end.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";

import { buildBaseUrl, resetServerViaAdmin } from "./support/server_process.js";
import { type McpHttpClient, clientFactory, type ClientInfo } from "./support/mcp_http.js";
import { type SseEventCollector, extractEventType, parseJsonRecord } from "./support/sse.js";
import { getStringField, isRecord } from "./support/json.js";
import {
  bindSpawnedServer,
  connectAdminEventsStream,
  eventWaiter,
  firstStreamEvent,
  firstStreamEventJson,
} from "./support/streaming.js";

const TEST_PORT = 4043;
const BASE_URL = buildBaseUrl(TEST_PORT);
const EVENT_TIMEOUT_MS = 1000;
const TMP_PREFIX = "/tmp/tmc-streaming-e2e-";
const TEST_FILE_PATH = "/stream/e2e.dart";
const ROUND_TRIP_FILE_PATH = "/roundtrip/test.dart";
const SECOND_AGENT = "stream-all-2";
const CONCURRENT_AGENT_COUNT = 5;
const BROADCAST = "*";
const ROUND_TRIP_STEP_COUNT = 5;

const EVENT_AGENT_REGISTERED = "agent_registered";
const EVENT_LOCK_ACQUIRED = "lock_acquired";
const EVENT_LOCK_RELEASED = "lock_released";
const EVENT_PLAN_UPDATED = "plan_updated";
const EVENT_MESSAGE_SENT = "message_sent";

const ADMIN_CLIENT_INFO: ClientInfo = { name: "streaming-e2e-test", version: "1.0.0" };
const MCP_CLIENT_INFO: ClientInfo = { name: "streaming-e2e-mcp", version: "1.0.0" };

// ============================================================
// Helpers
// ============================================================

/** Opens the admin GET /admin/events notification stream. */
const connectAdminStream = async (): Promise<SseEventCollector> =>
  connectAdminEventsStream(BASE_URL, ADMIN_CLIENT_INFO);

/** Registers `name` through `client`; returns the parsed payload. */
const registerOn = async (
  client: McpHttpClient,
  name: string,
): Promise<Record<string, unknown>> =>
  parseJsonRecord(await client.callTool("register", { name }));

/** Waits for events with this suite's shorter timeout budget. */
const waitForEvents = eventWaiter(EVENT_TIMEOUT_MS);

const newMcpClient = clientFactory(BASE_URL, MCP_CLIENT_INFO);

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

/** One streamed tool call: what it does, the event it must emit, and why. */
type StreamStep = {
  readonly label: string;
  readonly expectedEvent: string;
  readonly call: () => Promise<unknown>;
};

/** The parameters a lock+plan+message+release scenario runs with. */
type StreamScenario = {
  readonly key: string;
  readonly filePath: string;
  readonly toAgent: string;
  readonly content: string;
  readonly goal: string;
  readonly currentTask: string;
  readonly lockReason: string;
};

/** The four streamed tool steps every scenario exercises, in order. */
const toolSteps = (
  client: McpHttpClient,
  scenario: StreamScenario,
): readonly StreamStep[] => [
  {
    label: "MUST get stream event for lock acquire",
    expectedEvent: EVENT_LOCK_ACQUIRED,
    call: async (): Promise<unknown> => await client.callTool("lock", {
      action: "acquire",
      file_path: scenario.filePath,
      agent_key: scenario.key,
      reason: scenario.lockReason,
    }),
  },
  {
    label: "MUST get stream event for plan update",
    expectedEvent: EVENT_PLAN_UPDATED,
    call: async (): Promise<unknown> => await client.callTool("plan", {
      action: "update",
      agent_key: scenario.key,
      goal: scenario.goal,
      current_task: scenario.currentTask,
    }),
  },
  {
    label: "MUST get stream event for message send",
    expectedEvent: EVENT_MESSAGE_SENT,
    call: async (): Promise<unknown> => await client.callTool("message", {
      action: "send",
      agent_key: scenario.key,
      to_agent: scenario.toAgent,
      content: scenario.content,
    }),
  },
  {
    label: "MUST get stream event for lock release",
    expectedEvent: EVENT_LOCK_RELEASED,
    call: async (): Promise<unknown> => await client.callTool("lock", {
      action: "release",
      file_path: scenario.filePath,
      agent_key: scenario.key,
    }),
  },
];

/** Runs every step; returns the event types each one produced. */
const runStreamedSteps = async (
  stream: SseEventCollector,
  steps: readonly StreamStep[],
): Promise<readonly string[]> => {
  const seen: string[] = [];
  for (const step of steps) {
    await step.call();
    const events = await waitForEvents(stream, 1);
    assert.ok(events.length > 0, step.label);
    const types: readonly string[] = events.map((event) => extractEventType(event) ?? "");
    assert.ok(types.includes(step.expectedEvent), step.label);
    seen.push(...types);
  }
  return seen;
};

describe("Streaming E2E - Events Over Streamable HTTP", () => {
  bindSpawnedServer(TEST_PORT, TMP_PREFIX, BASE_URL);
  let mcpClient: McpHttpClient;

  beforeEach(async () => {
    await resetServerViaAdmin(BASE_URL);
    mcpClient = newMcpClient();
    await mcpClient.initSession();
  });

  it("admin stream receives event when agent registers", async () => {
    // 1. Open admin stream
    const stream = await connectAdminStream();

    // 2. Register agent via MCP tool call
    const regJson = await registerOn(mcpClient, "stream-agent-1");
    assert.strictEqual(regJson.agent_name, "stream-agent-1");

    // 3. ASSERT: stream event arrives
    const firstEvent = await firstStreamEvent(stream, EVENT_TIMEOUT_MS);
    assert.ok(
      firstEvent.includes("notifications/message"),
      "Stream event MUST be an MCP logging notification",
    );
  });

  it("admin stream receives events for ALL tool operations", async () => {
    const stream = await connectAdminStream();

    // Register 2 agents
    const reg1 = await registerOn(mcpClient, "stream-all-1");
    const key1 = getStringField(reg1, "agent_key");

    await registerOn(mcpClient, SECOND_AGENT);

    // Wait for register events
    const regEvents = await waitForEvents(stream, 2);
    assert.ok(
      regEvents.length >= 2,
      "MUST get events for both registrations",
    );

    await runStreamedSteps(stream, toolSteps(mcpClient, {
      key: key1,
      filePath: TEST_FILE_PATH,
      toAgent: SECOND_AGENT,
      content: "streaming e2e test message",
      goal: "Stream e2e goal",
      currentTask: "Testing streaming",
      lockReason: "e2e test",
    }));

    stream.close();
  });

  it("stream events contain correct payload structure", async () => {
    const stream = await connectAdminStream();

    // Register agent
    await registerOn(mcpClient, "payload-check");

    // Parse the stream data as JSON-RPC notification
    const eventJson = await firstStreamEventJson(stream, EVENT_TIMEOUT_MS);
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
      EVENT_AGENT_REGISTERED,
      "Event type MUST be agent_registered for register",
    );
  });

  it("multiple stream clients each receive all events", async () => {
    // Open 2 independent streams
    const stream1 = await connectAdminStream();
    const stream2 = await connectAdminStream();

    // Register agent
    await registerOn(mcpClient, "multi-stream-test");

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
    const regPromises = Array.from({ length: CONCURRENT_AGENT_COUNT }, async (_, i) =>
      mcpClient.callTool("register", { name: `concurrent-${String(i)}` }),
    );
    await Promise.all(regPromises);

    // MUST receive events for all 5 registrations
    const events = await waitForEvents(stream, CONCURRENT_AGENT_COUNT);
    stream.close();

    assert.ok(
      events.length >= CONCURRENT_AGENT_COUNT,
      `MUST receive ${String(CONCURRENT_AGENT_COUNT)} events for ` +
        `${String(CONCURRENT_AGENT_COUNT)} concurrent registrations`,
    );
  });

  it("admin REST push delivers events to stream", async () => {
    // Register via MCP first so agents exist
    const reg = await registerOn(mcpClient, "admin-push-agent");

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

    // Register
    const reg = await registerOn(mcpClient, "roundtrip-agent");
    const key = getStringField(reg, "agent_key");
    const registerEvents = await waitForEvents(stream, 1);

    const eventTypes: string[] = registerEvents.map((e) => extractEventType(e) ?? "");
    eventTypes.push(
      ...(await runStreamedSteps(stream, toolSteps(mcpClient, {
        key,
        filePath: ROUND_TRIP_FILE_PATH,
        toAgent: BROADCAST,
        content: "Roundtrip broadcast",
        goal: "Roundtrip goal",
        currentTask: "Roundtrip task",
        lockReason: "roundtrip",
      }))),
    );

    stream.close();

    // MUST have received events for all operations
    assert.ok(
      eventTypes.length >= ROUND_TRIP_STEP_COUNT,
      "MUST receive at least 5 stream events for " +
        "register+lock+plan+message+release",
    );

    for (const expected of [
      EVENT_AGENT_REGISTERED,
      EVENT_LOCK_ACQUIRED,
      EVENT_PLAN_UPDATED,
      EVENT_MESSAGE_SENT,
      EVENT_LOCK_RELEASED,
    ]) {
      assert.ok(eventTypes.includes(expected), `MUST have ${expected} event`);
    }
  });
});
