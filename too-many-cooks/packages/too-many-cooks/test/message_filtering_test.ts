/// Regression test: message_sent notifications must only be delivered
/// to the recipient agent, not to all agents.
///
/// Bug: currently emitter.emit(eventMessageSent, ...) broadcasts to ALL
/// agents regardless of who the message is addressed to.

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
  MCP_PATH,
  McpHttpClient,
  type ClientInfo,
} from "./support/mcp_http.js";
import {
  SseEventCollector,
  extractEventType,
  parseJsonRecord,
} from "./support/sse.js";
import { assertDefined } from "./support/assertions.js";
import { getStringField } from "./support/json.js";
import { removeTree } from "./support/fs_helpers.js";

const TEST_PORT = 4055;
const BASE_URL = `http://localhost:${String(TEST_PORT)}`;
const STREAM_ESTABLISH_DELAY_MS = 300;
const EVENT_TIMEOUT_MS = 1500;
const TMP_PREFIX = "/tmp/tmc-msg-filter-";

const CLIENT_INFO: ClientInfo = { name: "msg-filter-test", version: "1.0" };

// ============================================================
// Helpers
// ============================================================

const newClient = (): McpHttpClient =>
  new McpHttpClient({ baseUrl: BASE_URL, clientInfo: CLIENT_INFO });

/** Opens the agent's GET /mcp notification stream. */
const connectAgentStream = async (
  sessionId: string,
): Promise<SseEventCollector> =>
  SseEventCollector.open({
    url: `${BASE_URL}${MCP_PATH}`,
    headers: { Accept: ACCEPT_STREAMABLE, "mcp-session-id": sessionId },
    settleMs: STREAM_ESTABLISH_DELAY_MS,
  });

/** Waits for events with this suite's timeout budget. */
const waitForEvents = async (
  stream: SseEventCollector,
  count: number,
): Promise<string[]> => stream.waitForEvents(count, EVENT_TIMEOUT_MS);

let spawned: SpawnedServer | undefined;

describe("message filtering", () => {
  let serverProcess: ChildProcess;

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
  });

  it("message_sent is NOT delivered to agent that is not the recipient", async () => {
    // Three agents: sender, recipient, bystander.
    // sender sends to recipient.
    // bystander MUST NOT receive the message_sent notification.
    const sender = newClient();
    const recipient = newClient();
    const bystander = newClient();
    await sender.initSession();
    await recipient.initSession();
    await bystander.initSession();

    const senderReg = parseJsonRecord(
      await sender.callTool("register", { name: "sender" }),
    );
    await recipient.callTool("register", { name: "recipient" });
    await bystander.callTool("register", { name: "bystander" });

    const senderKey = getStringField(senderReg, "agent_key");

    // Open streams AFTER registration to avoid buffered events.
    const recipientStream = await connectAgentStream(recipient.getSessionId());
    const bystanderStream = await connectAgentStream(bystander.getSessionId());

    // Send a message from sender to recipient only.
    await sender.callTool("message", {
      action: "send",
      agent_key: senderKey,
      to_agent: "recipient",
      content: "hello recipient",
    });

    const recipientEvents = await waitForEvents(recipientStream, 1);
    const bystanderEvents = await waitForEvents(bystanderStream, 1);

    recipientStream.close();
    bystanderStream.close();

    // Recipient MUST get a message_sent notification.
    assert.strictEqual(
      recipientEvents.length > 0,
      true,
      "recipient MUST receive message_sent notification",
    );
    const firstRecipientEvent = recipientEvents[0];
    assertDefined(firstRecipientEvent, "recipient event payload");
    const recipientEventType = extractEventType(firstRecipientEvent);
    assert.strictEqual(
      recipientEventType,
      "message_sent",
      "recipient event type MUST be message_sent",
    );

    // Bystander MUST NOT get any message_sent notification.
    const bystanderMessageEvents = bystanderEvents.filter(
      (e) => extractEventType(e) === "message_sent",
    );
    assert.strictEqual(
      bystanderMessageEvents.length === 0,
      true,
      "bystander MUST NOT receive message_sent for a message not addressed to them",
    );
  });

  it("broadcast message_sent (* recipient) IS delivered to all agents", async () => {
    const sender = newClient();
    const agent2 = newClient();
    await sender.initSession();
    await agent2.initSession();

    const senderReg = parseJsonRecord(
      await sender.callTool("register", { name: "sender-b" }),
    );
    await agent2.callTool("register", { name: "agent2-b" });

    const senderKey = getStringField(senderReg, "agent_key");

    const agent2Stream = await connectAgentStream(agent2.getSessionId());

    await sender.callTool("message", {
      action: "send",
      agent_key: senderKey,
      to_agent: "*",
      content: "broadcast!",
    });

    const events = await waitForEvents(agent2Stream, 1);
    agent2Stream.close();

    assert.strictEqual(
      events.length > 0,
      true,
      "agent2 MUST receive broadcast message_sent",
    );
    const firstEvent = events[0];
    assertDefined(firstEvent, "agent2 event payload");
    assert.strictEqual(
      extractEventType(firstEvent),
      "message_sent",
      "event type MUST be message_sent",
    );
  });
});
