/// Integration tests — register tool reconnect flows (key-only,
/// name+key rejection, invalid key) and message mark_read.

import { describe, it } from "node:test";
import assert from "node:assert";

import { assertDefined } from "./support/assertions.js";
import { getStringField, parseJsonRecord } from "./support/json.js";
import {
  bindIntegrationLifecycle,
  createIntegrationServer,
  registerAgents,
} from "./support/integration_server.js";

const TEST_PORT = 4060;
const TMP_PREFIX = "/tmp/tmc-integration-register-";

describe("Too Many Cooks MCP Server Integration", () => {
  // Server for the file; DB reset + fresh MCP client for each test
  const suite = bindIntegrationLifecycle(
    createIntegrationServer(TEST_PORT, TMP_PREFIX),
  );

  // REGISTER: reconnect with key only
  it("register reconnect with key only", async () => {
    const client = suite.client();
    // First registration - name only
    const regResult = await client.callTool("register", { name: "recon1" });
    const regJson = parseJsonRecord(regResult);
    const key = getStringField(regJson, "agent_key");

    // Reconnect - key only, no name
    const reconResult = await client.callTool("register", { key });
    const reconJson = parseJsonRecord(reconResult);
    assert.strictEqual(reconJson.agent_name, "recon1");
    assert.strictEqual(reconJson.agent_key, key);
  });

  it("register with both name and key returns error", async () => {
    const client = suite.client();
    const regResult = await client.callTool("register", { name: "both1" });
    const regJson = parseJsonRecord(regResult);
    const key = getStringField(regJson, "agent_key");

    // Both name AND key - spec says this is an error
    const result = await client.callToolRaw("register", {
      name: "both1",
      key,
    });
    assert.strictEqual(result.isError, true);
  });

  it("register reconnect with invalid key returns error", async () => {
    const client = suite.client();
    const result = await client.callToolRaw("register", {
      key: "definitely-not-a-real-key",
    });
    assert.strictEqual(result.isError, true);
  });

  // MESSAGE TOOL: mark_read action
  it("message mark_read marks message as read", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, 2);
    const sender = agents[0];
    const recipient = agents[1];
    assertDefined(sender, "sender agent");
    assertDefined(recipient, "recipient agent");

    // Send a message
    const sendResult = await client.callTool("message", {
      action: "send",
      agent_key: sender.key,
      to_agent: recipient.name,
      content: "Test message",
    });
    const sendJson = parseJsonRecord(sendResult);
    const messageId = getStringField(sendJson, "message_id");

    // Mark as read
    const result = await client.callTool("message", {
      action: "mark_read",
      agent_key: recipient.key,
      message_id: messageId,
    });
    const json = parseJsonRecord(result);
    assert.strictEqual(json.marked, true);
  });
});
