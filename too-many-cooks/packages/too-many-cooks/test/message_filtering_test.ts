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
  buildBaseUrl,
  killServer,
  resetServerViaAdmin,
  spawnServer,
  waitForServer,
} from "./support/server_process.js";
import {
  type McpHttpClient,
  clientFactory,
  registerAgentKey,
  type ClientInfo,
} from "./support/mcp_http.js";
import { type SseEventCollector, extractEventType } from "./support/sse.js";
import {
  connectAgentEventsStream,
  eventWaiter,
  firstStreamEvent,
} from "./support/streaming.js";
import { removeTree } from "./support/fs_helpers.js";

const TEST_PORT = 4055;
const BASE_URL = buildBaseUrl(TEST_PORT);
const STREAM_ESTABLISH_DELAY_MS = 300;
const EVENT_TIMEOUT_MS = 1500;
const TMP_PREFIX = "/tmp/tmc-msg-filter-";
const BROADCAST = "*";
const EVENT_MESSAGE_SENT = "message_sent";

const CLIENT_INFO: ClientInfo = { name: "msg-filter-test", version: "1.0" };

// ============================================================
// Helpers
// ============================================================

const newClient = clientFactory(BASE_URL, CLIENT_INFO);

/** A fresh client with an initialized MCP session. */
const newSessionClient = async (): Promise<McpHttpClient> => {
  const client = newClient();
  await client.initSession();
  return client;
};

/** Opens the agent's GET /mcp notification stream. */
const connectAgentStream = async (
  sessionId: string,
): Promise<SseEventCollector> =>
  connectAgentEventsStream(BASE_URL, sessionId, STREAM_ESTABLISH_DELAY_MS);

/** Waits for events with this suite's timeout budget. */
const waitForEvents = eventWaiter(EVENT_TIMEOUT_MS);

/** Sends `content` from `sender` (authenticated by `senderKey`) to `toAgent`. */
const sendAs = async (
  sender: McpHttpClient,
  senderKey: string,
  toAgent: string,
  content: string,
): Promise<void> => {
  await sender.callTool("message", {
    action: "send",
    agent_key: senderKey,
    to_agent: toAgent,
    content,
  });
};

/** Asserts `stream` delivered a `message_sent` event; `message` names why. */
const assertMessageSentEvent = async (
  stream: SseEventCollector,
  message: string,
): Promise<void> => {
  assert.strictEqual(
    extractEventType(await firstStreamEvent(stream, EVENT_TIMEOUT_MS)),
    EVENT_MESSAGE_SENT,
    message,
  );
};

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
    const sender = await newSessionClient();
    const recipient = await newSessionClient();
    const bystander = await newSessionClient();

    const senderKey = await registerAgentKey(sender, "sender");
    await registerAgentKey(recipient, "recipient");
    await registerAgentKey(bystander, "bystander");

    // Open streams AFTER registration to avoid buffered events.
    const recipientStream = await connectAgentStream(recipient.getSessionId());
    const bystanderStream = await connectAgentStream(bystander.getSessionId());

    // Send a message from sender to recipient only.
    await sendAs(sender, senderKey, "recipient", "hello recipient");

    const bystanderEvents = await waitForEvents(bystanderStream, 1);

    bystanderStream.close();

    // Recipient MUST get a message_sent notification.
    await assertMessageSentEvent(
      recipientStream,
      "recipient MUST receive message_sent notification",
    );

    // Bystander MUST NOT get any message_sent notification.
    const bystanderMessageEvents = bystanderEvents.filter(
      (e) => extractEventType(e) === EVENT_MESSAGE_SENT,
    );
    assert.strictEqual(
      bystanderMessageEvents.length === 0,
      true,
      "bystander MUST NOT receive message_sent for a message not addressed to them",
    );
  });

  it("broadcast message_sent (* recipient) IS delivered to all agents", async () => {
    const sender = await newSessionClient();
    const agent2 = await newSessionClient();

    const senderKey = await registerAgentKey(sender, "sender-b");
    await registerAgentKey(agent2, "agent2-b");

    const agent2Stream = await connectAgentStream(agent2.getSessionId());

    await sendAs(sender, senderKey, BROADCAST, "broadcast!");

    await assertMessageSentEvent(
      agent2Stream,
      "agent2 MUST receive broadcast message_sent",
    );
  });
});
