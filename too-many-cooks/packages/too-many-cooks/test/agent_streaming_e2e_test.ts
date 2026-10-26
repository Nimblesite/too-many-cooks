/// E2E agent streaming test — spawn MCP server, open Streamable HTTP
/// stream on /mcp for an AGENT session, trigger state changes from
/// another agent, ASSERT that notifications arrive over the
/// agent's stream.
///
/// This PROVES that agents receive streamed notifications over
/// their Streamable HTTP connection.

import { describe, it } from "node:test";
import assert from "node:assert";

import { resetServerViaAdmin } from "./support/server_process.js";
import {
  ACCEPT_STREAMABLE,
  MCP_PATH,
  McpHttpClient,
  type ClientInfo,
} from "./support/mcp_http.js";
import {
  SseEventCollector,
  extractEventType,
  parseJsonRecord,
} from "./support/sse.js";
import { getRecordField, getStringField } from "./support/json.js";
import { bindSpawnedServer } from "./support/streaming.js";

// ============================================================
// Named Constants
// ============================================================

const TEST_PORT = 4046;
const BASE_URL = `http://localhost:${String(TEST_PORT)}`;
const DEFAULT_EVENT_TIMEOUT_MS = 3000;
const TMP_PREFIX = "/tmp/tmc-agent-streaming-";

const CLIENT_INFO: ClientInfo = { name: "agent-streaming-e2e", version: "1.0.0" };

const AGENT_1_NAME = "agent-stream-1";
const AGENT_2_NAME = "agent-stream-2";
const AGENT_3_NAME = "agent-stream-3";

const TEST_FILE_PATH = "/agent-stream/test.dart";
const TEST_LOCK_REASON = "agent streaming e2e";
const TEST_MESSAGE_CONTENT = "hello from agent1";
const TEST_GOAL = "Agent streaming goal";
const TEST_TASK = "Testing agent streaming";

const EVENT_AGENT_REGISTERED = "agent_registered";
const EVENT_LOCK_ACQUIRED = "lock_acquired";
const EVENT_LOCK_RELEASED = "lock_released";
const EVENT_MESSAGE_SENT = "message_sent";
const EVENT_PLAN_UPDATED = "plan_updated";

const JSON_RPC_VERSION = "2.0";
const NOTIFICATION_METHOD = "notifications/message";
const LEVEL_INFO = "info";

// ============================================================
// Helpers
// ============================================================

type AgentClients = {
  readonly sender: McpHttpClient;
  readonly listener: McpHttpClient;
};

/** What a stream trigger can act on: the sender client and its key. */
type StreamContext = {
  readonly sender: McpHttpClient;
  readonly key1: string;
};

const newClient = (): McpHttpClient =>
  new McpHttpClient({ baseUrl: BASE_URL, clientInfo: CLIENT_INFO });

/** Resets the server and initializes two fresh clients ([DEDUP-DESLOP]). */
const freshAgentClients = async (): Promise<AgentClients> => {
  await resetServerViaAdmin(BASE_URL);
  const sender = newClient();
  const listener = newClient();
  await sender.initSession();
  await listener.initSession();
  return { sender, listener };
};

/** Registers both agents and returns the sender's key. */
const registerPair = async (clients: AgentClients): Promise<string> => {
  const reg1 = parseJsonRecord(
    await clients.sender.callTool("register", { name: AGENT_1_NAME }),
  );
  await clients.listener.callTool("register", { name: AGENT_2_NAME });
  return getStringField(reg1, "agent_key");
};

/** Opens the agent's GET /mcp notification stream. */
const connectAgentStream = async (
  sessionId: string,
): Promise<SseEventCollector> =>
  SseEventCollector.open({
    url: `${BASE_URL}${MCP_PATH}`,
    headers: { Accept: ACCEPT_STREAMABLE, "mcp-session-id": sessionId },
  });

/** Waits for one event, closes the stream, asserts its type. */
const expectStreamEvent = async (
  stream: SseEventCollector,
  expected: string,
): Promise<void> => {
  const events = await stream.waitForEvents(1, DEFAULT_EVENT_TIMEOUT_MS);
  stream.close();
  assert.strictEqual(events.length > 0, true);
  assert.strictEqual(extractEventType(events[0] ?? ""), expected);
};

/** Fresh clients + pair registration + open stream + trigger + expect event. */
const withStreamEvent = async (
  expected: string,
  trigger: (ctx: StreamContext) => Promise<void>,
): Promise<void> => {
  const clients = await freshAgentClients();
  const key1 = await registerPair(clients);
  const stream = await connectAgentStream(clients.listener.getSessionId());
  await trigger({ sender: clients.sender, key1 });
  await expectStreamEvent(stream, expected);
};

// ============================================================
// Tests
// ============================================================

describe("agent_streaming_e2e_test", () => {
  bindSpawnedServer(TEST_PORT, TMP_PREFIX, BASE_URL);

  it("agent receives message_sent notification via stream", async () => {
    await withStreamEvent(EVENT_MESSAGE_SENT, async ({ sender, key1 }) => {
      await sender.callTool("message", {
        action: "send",
        agent_key: key1,
        to_agent: AGENT_2_NAME,
        content: TEST_MESSAGE_CONTENT,
      });
    });
  });

  it("agent receives lock_acquired notification via stream", async () => {
    await withStreamEvent(EVENT_LOCK_ACQUIRED, async ({ sender, key1 }) => {
      await sender.callTool("lock", {
        action: "acquire",
        file_path: TEST_FILE_PATH,
        agent_key: key1,
        reason: TEST_LOCK_REASON,
      });
    });
  });

  it("agent receives agent_registered notification via stream", async () => {
    await withStreamEvent(EVENT_AGENT_REGISTERED, async ({ sender }) => {
      // Register a third agent — agent2 should get notified
      await sender.callTool("register", { name: AGENT_3_NAME });
    });
  });

  it("agent receives plan_updated notification via stream", async () => {
    await withStreamEvent(EVENT_PLAN_UPDATED, async ({ sender, key1 }) => {
      await sender.callTool("plan", {
        action: "update",
        agent_key: key1,
        goal: TEST_GOAL,
        current_task: TEST_TASK,
      });
    });
  });

  it("agent receives lock_released notification via stream", async () => {
    const clients = await freshAgentClients();
    const key1 = await registerPair(clients);

    // Acquire lock first
    await clients.sender.callTool("lock", {
      action: "acquire",
      file_path: TEST_FILE_PATH,
      agent_key: key1,
      reason: TEST_LOCK_REASON,
    });

    const stream = await connectAgentStream(clients.listener.getSessionId());

    // Release the lock
    await clients.sender.callTool("lock", {
      action: "release",
      file_path: TEST_FILE_PATH,
      agent_key: key1,
    });

    await expectStreamEvent(stream, EVENT_LOCK_RELEASED);
  });

  it("agent notification has correct JSON-RPC payload structure", async () => {
    const clients = await freshAgentClients();
    await registerPair(clients);

    const stream = await connectAgentStream(clients.listener.getSessionId());

    // Register agent3 to trigger a notification
    await clients.sender.callTool("register", { name: AGENT_3_NAME });

    const events = await stream.waitForEvents(1, DEFAULT_EVENT_TIMEOUT_MS);
    stream.close();

    assert.strictEqual(events.length > 0, true);

    const eventJson = parseJsonRecord(events[0] ?? "");

    // Verify JSON-RPC envelope
    assert.strictEqual(eventJson.jsonrpc, JSON_RPC_VERSION);
    assert.strictEqual(eventJson.method, NOTIFICATION_METHOD);

    // Verify params structure
    const params = getRecordField(eventJson, "params");
    assert.strictEqual(params.level, LEVEL_INFO);

    // Verify data structure
    const data = getRecordField(params, "data");
    assert.strictEqual("event" in data, true);
    assert.strictEqual("payload" in data, true);
    assert.strictEqual("timestamp" in data, true);
    assert.strictEqual(data.event, EVENT_AGENT_REGISTERED);
  });
});
