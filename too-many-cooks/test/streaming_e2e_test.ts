/// E2E streaming test - spawn MCP server, open Streamable HTTP
/// stream on /admin/events, trigger state changes via tool calls,
/// ASSERT that events arrive over the stream.
///
/// This is the PROOF that Streamable HTTP push works end-to-end.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";

const TEST_PORT = 4043;
const BASE_URL = `http://localhost:${String(TEST_PORT)}`;
const ACCEPT = "application/json, text/event-stream";
const ADMIN_EVENTS_PATH = "/admin/events";
const MCP_PROTOCOL_VERSION = "2025-03-26";
const DEFAULT_EVENT_TIMEOUT_MS = 1000;

import { SERVER_BINARY, SERVER_NODE_ARGS } from "../lib/src/config.js";

// ============================================================
// Server lifecycle helpers
// ============================================================

let tmpWorkspace = "";

const spawnServer = (): ChildProcess => {
  tmpWorkspace = fs.mkdtempSync("/tmp/tmc-streaming-e2e-");
  return spawn("node", [...SERVER_NODE_ARGS, SERVER_BINARY], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, TMC_PORT: String(TEST_PORT), TMC_WORKSPACE: tmpWorkspace },
  });
};

const killProcess = (proc: ChildProcess): void => {
  proc.kill();
};

const waitForServer = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE_URL}/admin/status`);
      if (r.ok) {return;}
    } catch {
      // Not ready yet
    }
    if (i === 29) {throw new Error("Server failed to start");}
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
};

const resetServer = async (): Promise<void> => {
  const r = await fetch(`${BASE_URL}/admin/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!r.ok) {
    throw new Error("Failed to reset server");
  }
};


// ============================================================
// Admin Stream Client - opens GET /admin/events and reads events
// ============================================================

class AdminStreamClient {
  private readonly events: string[] = [];
  private consumed = 0;
  private controller: AbortController | undefined;

  /// Connect: init admin session, then open GET stream.
  static async connect(): Promise<AdminStreamClient> {
    const sessionId = await initAdminSession();
    const client = new AdminStreamClient();
    client.controller = new AbortController();
    // Start reading in the background
    void client.startReading(sessionId).catch((): void => { /* noop */ });
    // Give the stream a moment to establish
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    return client;
  }

  private async startReading(sessionId: string): Promise<void> {
    try {
      const response = await fetch(`${BASE_URL}${ADMIN_EVENTS_PATH}`, {
        method: "GET",
        headers: {
          Accept: ACCEPT,
          "mcp-session-id": sessionId,
        },
        signal: this.controller?.signal,
      });

      if (!response.ok || response.body === null) {return;}

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {break;}

        buffer += decoder.decode(value, { stream: true });

        // Parse stream lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.substring(6).trim();
            if (data.length > 0) {
              this.events.push(data);
            }
          }
        }
      }
    } catch {
      // Stream aborted or errored - expected on close()
    }
  }

  /// Wait for at least [count] NEW events (beyond what
  /// we've already consumed).
  async waitForEvents(
    count: number,
    timeoutMs: number = DEFAULT_EVENT_TIMEOUT_MS,
  ): Promise<string[]> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.events.length - this.consumed >= count) {
        const result = this.events.slice(this.consumed);
        this.consumed = this.events.length;
        return result;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    const result = this.events.slice(this.consumed);
    this.consumed = this.events.length;
    return result;
  }

  close(): void {
    this.controller?.abort();
  }
}

/// Initialize an admin MCP session and return the session ID.
const initAdminSession = async (): Promise<string> => {
  const response = await fetch(`${BASE_URL}${ADMIN_EVENTS_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: ACCEPT,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "streaming-e2e-test", version: "1.0.0" },
      },
    }),
  });

  const sessionId = response.headers.get("mcp-session-id");
  if (sessionId === null) {
    throw new Error("No admin session ID in response");
  }

  // Send initialized notification
  await fetch(`${BASE_URL}${ADMIN_EVENTS_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: ACCEPT,
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }),
  });

  return sessionId;
};

// ============================================================
// MCP Client (reused from integration_test pattern)
// ============================================================

class McpClient {
  private sessionId: string | undefined;
  private nextId = 1;

  async initSession(): Promise<void> {
    const initResult = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "streaming-e2e-mcp", version: "1.0.0" },
    });
    if (this.sessionId === undefined) {
      throw new Error(`No session ID after init: ${JSON.stringify(initResult)}`);
    }
    await this.postMcp(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }),
    );
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });
    const content = (result.content as Array<Record<string, unknown>>)[0];
    return content?.text as string;
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
    const response = await this.postMcp(body);
    const text = await response.text();
    const json = this.parseMcpResponse(text);
    if ("error" in json && json.error !== undefined) {
      const err = json.error as Record<string, unknown>;
      const message = (err.message as string) ?? "Error";
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
    return json.result as Record<string, unknown>;
  }

  private async postMcp(body: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: ACCEPT,
    };
    if (this.sessionId !== undefined) {
      headers["mcp-session-id"] = this.sessionId;
    }
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers,
      body,
    });
    const sid = response.headers.get("mcp-session-id");
    if (sid !== null) {this.sessionId = sid;}
    return response;
  }

  private parseMcpResponse(text: string): Record<string, unknown> {
    if (text.trimStart().startsWith("{")) {
      return JSON.parse(text) as Record<string, unknown>;
    }
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          return JSON.parse(line.substring(6)) as Record<string, unknown>;
        } catch {
          continue;
        }
      }
    }
    throw new Error(`Could not parse: ${text}`);
  }
}

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

// ============================================================
// Tests
// ============================================================

describe("Streaming E2E - Events Over Streamable HTTP", () => {
  let serverProcess: ChildProcess;
  let mcpClient: McpClient;

  before(async () => {
    serverProcess = spawnServer();
    await waitForServer();
  });

  after(() => {
    killProcess(serverProcess);
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetServer();
    mcpClient = new McpClient();
    await mcpClient.initSession();
  });

  it("admin stream receives event when agent registers", async () => {
    // 1. Open admin stream
    const stream = await AdminStreamClient.connect();

    // 2. Register agent via MCP tool call
    const regResult = await mcpClient.callTool("register", {
      name: "stream-agent-1",
    });
    const regJson = JSON.parse(regResult) as Record<string, unknown>;
    assert.strictEqual(regJson.agent_name, "stream-agent-1");

    // 3. ASSERT: stream event arrives
    const events = await stream.waitForEvents(1);
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
    const stream = await AdminStreamClient.connect();

    // Register 2 agents
    const reg1 = JSON.parse(
      await mcpClient.callTool("register", { name: "stream-all-1" }),
    ) as Record<string, unknown>;
    const key1 = reg1.agent_key as string;

    JSON.parse(
      await mcpClient.callTool("register", { name: "stream-all-2" }),
    ) as Record<string, unknown>;

    // Wait for register events
    const regEvents = await stream.waitForEvents(2);
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
    const lockEvents = await stream.waitForEvents(1);
    assert.ok(lockEvents.length > 0, "MUST get stream event for lock acquire");

    // Update plan
    await mcpClient.callTool("plan", {
      action: "update",
      agent_key: key1,
      goal: "Stream e2e goal",
      current_task: "Testing streaming",
    });

    // Wait for plan event
    const planEvents = await stream.waitForEvents(1);
    assert.ok(planEvents.length > 0, "MUST get stream event for plan update");

    // Send message
    await mcpClient.callTool("message", {
      action: "send",
      agent_key: key1,
      to_agent: "stream-all-2",
      content: "streaming e2e test message",
    });

    // Wait for message event
    const msgEvents = await stream.waitForEvents(1);
    assert.ok(msgEvents.length > 0, "MUST get stream event for message send");

    // Release lock
    await mcpClient.callTool("lock", {
      action: "release",
      file_path: "/stream/e2e.dart",
      agent_key: key1,
    });

    // Wait for release event
    const releaseEvents = await stream.waitForEvents(1);
    assert.ok(
      releaseEvents.length > 0,
      "MUST get stream event for lock release",
    );

    stream.close();
  });

  it("stream events contain correct payload structure", async () => {
    const stream = await AdminStreamClient.connect();

    // Register agent
    await mcpClient.callTool("register", { name: "payload-check" });

    const events = await stream.waitForEvents(1);
    stream.close();

    assert.ok(events.length > 0);

    // Parse the stream data as JSON-RPC notification
    const eventJson = JSON.parse(events[0]!) as Record<string, unknown>;
    assert.strictEqual(eventJson.jsonrpc, "2.0");
    assert.strictEqual(eventJson.method, "notifications/message");

    // Params must contain logging data
    const params = eventJson.params as Record<string, unknown> | undefined;
    assert.ok(params !== undefined);
    assert.strictEqual(params.level, "info");

    // Data must contain event and payload
    const data = params.data as Record<string, unknown> | undefined;
    assert.ok(data !== undefined);
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
    const stream1 = await AdminStreamClient.connect();
    const stream2 = await AdminStreamClient.connect();

    // Register agent
    await mcpClient.callTool("register", { name: "multi-stream-test" });

    // Both clients MUST receive the event
    const events1 = await stream1.waitForEvents(1);
    const events2 = await stream2.waitForEvents(1);

    stream1.close();
    stream2.close();

    assert.ok(events1.length > 0, "Stream client 1 MUST receive event");
    assert.ok(events2.length > 0, "Stream client 2 MUST receive event");
  });

  it("stream delivers events for concurrent tool calls", async () => {
    const stream = await AdminStreamClient.connect();

    // Register 5 agents concurrently
    const agentCount = 5;
    const regPromises = Array.from({ length: agentCount }, async (_, i) =>
      mcpClient.callTool("register", { name: `concurrent-${String(i)}` }),
    );
    await Promise.all(regPromises);

    // MUST receive events for all 5 registrations
    const events = await stream.waitForEvents(agentCount);
    stream.close();

    assert.ok(
      events.length >= agentCount,
      `MUST receive ${String(agentCount)} events for ` +
        `${String(agentCount)} concurrent registrations`,
    );
  });

  it("admin REST push delivers events to stream", async () => {
    // Register via MCP first so agents exist
    const reg = JSON.parse(
      await mcpClient.callTool("register", {
        name: "admin-push-agent",
      }),
    ) as Record<string, unknown>;

    const stream = await AdminStreamClient.connect();

    // Use admin REST to send message (bypasses MCP)
    await adminPost("/admin/send-message", {
      fromAgent: reg.agent_name as string,
      toAgent: "*",
      content: "Admin push test",
    });

    // Stream MUST receive the event
    const events = await stream.waitForEvents(1);
    stream.close();

    assert.ok(
      events.length > 0,
      "Admin REST push MUST deliver events to stream",
    );
  });

  it("full round trip: register, lock, plan, message all stream as events", async () => {
    const stream = await AdminStreamClient.connect();
    const allEvents: string[] = [];

    // Register
    const reg = JSON.parse(
      await mcpClient.callTool("register", {
        name: "roundtrip-agent",
      }),
    ) as Record<string, unknown>;
    const key = reg.agent_key as string;
    allEvents.push(...(await stream.waitForEvents(1)));

    // Lock
    await mcpClient.callTool("lock", {
      action: "acquire",
      file_path: "/roundtrip/test.dart",
      agent_key: key,
      reason: "roundtrip",
    });
    allEvents.push(...(await stream.waitForEvents(1)));

    // Plan
    await mcpClient.callTool("plan", {
      action: "update",
      agent_key: key,
      goal: "Roundtrip goal",
      current_task: "Roundtrip task",
    });
    allEvents.push(...(await stream.waitForEvents(1)));

    // Message
    await mcpClient.callTool("message", {
      action: "send",
      agent_key: key,
      to_agent: "*",
      content: "Roundtrip broadcast",
    });
    allEvents.push(...(await stream.waitForEvents(1)));

    // Release lock
    await mcpClient.callTool("lock", {
      action: "release",
      file_path: "/roundtrip/test.dart",
      agent_key: key,
    });
    allEvents.push(...(await stream.waitForEvents(1)));

    stream.close();

    // MUST have received events for all operations
    assert.ok(
      allEvents.length >= 5,
      "MUST receive at least 5 stream events for " +
        "register+lock+plan+message+release",
    );

    // Extract event types from all events
    const eventTypes = allEvents.map((e) => {
      const json = JSON.parse(e) as Record<string, unknown>;
      const params = json.params as Record<string, unknown> | undefined;
      const data = params?.data as Record<string, unknown> | undefined;
      return data?.event as string | undefined;
    });

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
