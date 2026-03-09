/// E2E agent streaming test — spawn MCP server, open SSE stream
/// on /mcp for an AGENT session, trigger state changes from
/// another agent, ASSERT that notifications arrive over the
/// agent's SSE stream.
///
/// This PROVES that agents receive streamed notifications over
/// their Streamable HTTP SSE connection.

import { describe, it, before, after } from "node:test";
import assert from "node:assert";

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";

import { SERVER_BINARY, SERVER_NODE_ARGS } from "../lib/src/config.js";

// ============================================================
// Named Constants
// ============================================================

const TEST_PORT = 4046;
const BASE_URL = `http://localhost:${String(TEST_PORT)}` as const;
const MCP_PATH = "/mcp" as const;
const ACCEPT = "application/json, text/event-stream" as const;
const MCP_PROTOCOL_VERSION = "2025-03-26" as const;
const DEFAULT_EVENT_TIMEOUT_MS = 3000;
const STREAM_ESTABLISH_DELAY_MS = 200;
const SERVER_POLL_DELAY_MS = 200;
const EVENT_POLL_DELAY_MS = 50;
const MAX_SERVER_POLL_ATTEMPTS = 30;

const AGENT_1_NAME = "agent-stream-1" as const;
const AGENT_2_NAME = "agent-stream-2" as const;
const AGENT_3_NAME = "agent-stream-3" as const;

const TEST_FILE_PATH = "/agent-stream/test.dart" as const;
const TEST_LOCK_REASON = "agent streaming e2e" as const;
const TEST_MESSAGE_CONTENT = "hello from agent1" as const;
const TEST_GOAL = "Agent streaming goal" as const;
const TEST_TASK = "Testing agent streaming" as const;

const EVENT_AGENT_REGISTERED = "agent_registered" as const;
const EVENT_LOCK_ACQUIRED = "lock_acquired" as const;
const EVENT_LOCK_RELEASED = "lock_released" as const;
const EVENT_MESSAGE_SENT = "message_sent" as const;
const EVENT_PLAN_UPDATED = "plan_updated" as const;

const JSON_RPC_VERSION = "2.0" as const;
const NOTIFICATION_METHOD = "notifications/message" as const;
const LEVEL_INFO = "info" as const;

const DB_DIR = ".too_many_cooks" as const;
const DB_FILES = ["data.db", "data.db-wal", "data.db-shm"] as const;

// ============================================================
// Helper: sleep
// ============================================================

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================
// Helper: parse JSON and extract event type
// ============================================================

const parseJson = (text: string): Record<string, unknown> =>
  JSON.parse(text) as Record<string, unknown>;

const extractEventType = (sseData: string): string | undefined => {
  const json = parseJson(sseData);
  const params = json.params as Record<string, unknown> | undefined;
  const data = params?.data as Record<string, unknown> | undefined;
  return data?.event as string | undefined;
};

// ============================================================
// Agent SSE Client — opens GET /mcp with agent session ID
// ============================================================

class AgentSseClient {
  private readonly events: string[] = [];
  private consumed = 0;
  private controller: AbortController | undefined;

  static async connect(sessionId: string): Promise<AgentSseClient> {
    const client = new AgentSseClient();
    client.controller = new AbortController();

    const headers: Record<string, string> = {
      Accept: ACCEPT,
      "mcp-session-id": sessionId,
    };

    void (async () => {
      try {
        const response = await fetch(`${BASE_URL}${MCP_PATH}`, {
          method: "GET",
          headers,
          signal: client.controller!.signal,
        });
        if (!response.ok || response.body === null) {return;}

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) {break;}

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.substring(6).trim();
              if (data.length > 0) {
                client.events.push(data);
              }
            }
          }
        }
      } catch {
        // Stream aborted — expected on close()
      }
    })();

    await sleep(STREAM_ESTABLISH_DELAY_MS);
    return client;
  }

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
      await sleep(EVENT_POLL_DELAY_MS);
    }
    const result = this.events.slice(this.consumed);
    this.consumed = this.events.length;
    return result;
  }

  close(): void {
    this.controller?.abort();
  }
}

// ============================================================
// MCP Client with exposed session ID
// ============================================================

class McpClient {
  private _sessionId = "";
  private nextId = 1;

  get sessionId(): string {
    if (this._sessionId.length === 0) {
      throw new Error("Session not initialized");
    }
    return this._sessionId;
  }

  async initSession(): Promise<void> {
    const initResult = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "agent-streaming-e2e", version: "1.0.0" },
    });
    if (this._sessionId.length === 0) {
      throw new Error(
        `No session ID after init: ${JSON.stringify(initResult)}`,
      );
    }
    await this.postMcp(
      JSON.stringify({
        jsonrpc: JSON_RPC_VERSION,
        method: "notifications/initialized",
        params: {},
      }),
    );
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });
    const content = (result.content as Array<Record<string, unknown>>)[0];
    return content.text as string;
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const body = JSON.stringify({
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      params,
    });
    const response = await this.postMcp(body);
    const text = await response.text();
    const json = this.parseMcpResponse(text);
    if ("error" in json) {
      const err = json.error as Record<string, unknown>;
      const message = (err.message as string | undefined) ?? "Error";
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
    if (this._sessionId.length > 0) {
      headers["mcp-session-id"] = this._sessionId;
    }
    const response = await fetch(`${BASE_URL}${MCP_PATH}`, {
      method: "POST",
      headers,
      body,
    });
    const sid = response.headers.get("mcp-session-id");
    if (sid !== null) {this._sessionId = sid;}
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

// ============================================================
// Server lifecycle helpers
// ============================================================

const spawnServer = (): ChildProcess =>
  spawn("node", [...SERVER_NODE_ARGS, SERVER_BINARY], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, TMC_PORT: String(TEST_PORT) },
  });

const waitForServer = async (): Promise<void> => {
  for (let i = 0; i < MAX_SERVER_POLL_ATTEMPTS; i++) {
    try {
      const r = await fetch(`${BASE_URL}/admin/status`);
      if (r.ok) {return;}
    } catch {
      // Not ready yet
    }
    if (i === MAX_SERVER_POLL_ATTEMPTS - 1) {
      throw new Error("Server failed to start");
    }
    await sleep(SERVER_POLL_DELAY_MS);
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

const deleteDbFiles = (): void => {
  for (const file of DB_FILES) {
    const path = `${DB_DIR}/${file}`;
    try {
      if (fs.existsSync(path)) {
        fs.unlinkSync(path);
      }
    } catch {
      // ignore
    }
  }
};

// ============================================================
// Tests
// ============================================================

describe("agent_streaming_e2e_test", () => {
  let serverProcess: ChildProcess;

  before(async () => {
    deleteDbFiles();
    serverProcess = spawnServer();
    await waitForServer();
  });

  after(() => {
    serverProcess.kill();
    deleteDbFiles();
  });

  it("agent receives message_sent notification via SSE", async () => {
    await resetServer();
    const agent1 = new McpClient();
    const agent2 = new McpClient();
    await agent1.initSession();
    await agent2.initSession();

    const reg1 = parseJson(
      await agent1.callTool("register", { name: AGENT_1_NAME }),
    );
    const reg2 = parseJson(
      await agent2.callTool("register", { name: AGENT_2_NAME }),
    );
    const key1 = reg1.agent_key as string;

    const sse = await AgentSseClient.connect(agent2.sessionId);

    await agent1.callTool("message", {
      action: "send",
      agent_key: key1,
      to_agent: reg2.agent_name as string,
      content: TEST_MESSAGE_CONTENT,
    });

    const events = await sse.waitForEvents(1);
    sse.close();

    assert.strictEqual(events.length > 0, true);
    const eventType = extractEventType(events[0]);
    assert.strictEqual(eventType, EVENT_MESSAGE_SENT);
  });

  it("agent receives lock_acquired notification via SSE", async () => {
    await resetServer();
    const agent1 = new McpClient();
    const agent2 = new McpClient();
    await agent1.initSession();
    await agent2.initSession();

    const reg1 = parseJson(
      await agent1.callTool("register", { name: AGENT_1_NAME }),
    );
    await agent2.callTool("register", { name: AGENT_2_NAME });
    const key1 = reg1.agent_key as string;

    const sse = await AgentSseClient.connect(agent2.sessionId);

    await agent1.callTool("lock", {
      action: "acquire",
      file_path: TEST_FILE_PATH,
      agent_key: key1,
      reason: TEST_LOCK_REASON,
    });

    const events = await sse.waitForEvents(1);
    sse.close();

    assert.strictEqual(events.length > 0, true);
    const eventType = extractEventType(events[0]);
    assert.strictEqual(eventType, EVENT_LOCK_ACQUIRED);
  });

  it("agent receives agent_registered notification via SSE", async () => {
    await resetServer();
    const agent1 = new McpClient();
    const agent2 = new McpClient();
    await agent1.initSession();
    await agent2.initSession();

    await agent1.callTool("register", { name: AGENT_1_NAME });
    await agent2.callTool("register", { name: AGENT_2_NAME });

    const sse = await AgentSseClient.connect(agent2.sessionId);

    // Register a third agent — agent2 should get notified
    await agent1.callTool("register", { name: AGENT_3_NAME });

    const events = await sse.waitForEvents(1);
    sse.close();

    assert.strictEqual(events.length > 0, true);
    const eventType = extractEventType(events[0]);
    assert.strictEqual(eventType, EVENT_AGENT_REGISTERED);
  });

  it("agent receives plan_updated notification via SSE", async () => {
    await resetServer();
    const agent1 = new McpClient();
    const agent2 = new McpClient();
    await agent1.initSession();
    await agent2.initSession();

    const reg1 = parseJson(
      await agent1.callTool("register", { name: AGENT_1_NAME }),
    );
    await agent2.callTool("register", { name: AGENT_2_NAME });
    const key1 = reg1.agent_key as string;

    const sse = await AgentSseClient.connect(agent2.sessionId);

    await agent1.callTool("plan", {
      action: "update",
      agent_key: key1,
      goal: TEST_GOAL,
      current_task: TEST_TASK,
    });

    const events = await sse.waitForEvents(1);
    sse.close();

    assert.strictEqual(events.length > 0, true);
    const eventType = extractEventType(events[0]);
    assert.strictEqual(eventType, EVENT_PLAN_UPDATED);
  });

  it("agent receives lock_released notification via SSE", async () => {
    await resetServer();
    const agent1 = new McpClient();
    const agent2 = new McpClient();
    await agent1.initSession();
    await agent2.initSession();

    const reg1 = parseJson(
      await agent1.callTool("register", { name: AGENT_1_NAME }),
    );
    await agent2.callTool("register", { name: AGENT_2_NAME });
    const key1 = reg1.agent_key as string;

    // Acquire lock first
    await agent1.callTool("lock", {
      action: "acquire",
      file_path: TEST_FILE_PATH,
      agent_key: key1,
      reason: TEST_LOCK_REASON,
    });

    const sse = await AgentSseClient.connect(agent2.sessionId);

    // Release the lock
    await agent1.callTool("lock", {
      action: "release",
      file_path: TEST_FILE_PATH,
      agent_key: key1,
    });

    const events = await sse.waitForEvents(1);
    sse.close();

    assert.strictEqual(events.length > 0, true);
    const eventType = extractEventType(events[0]);
    assert.strictEqual(eventType, EVENT_LOCK_RELEASED);
  });

  it("agent notification has correct JSON-RPC payload structure", async () => {
    await resetServer();
    const agent1 = new McpClient();
    const agent2 = new McpClient();
    await agent1.initSession();
    await agent2.initSession();

    await agent1.callTool("register", { name: AGENT_1_NAME });
    await agent2.callTool("register", { name: AGENT_2_NAME });

    const sse = await AgentSseClient.connect(agent2.sessionId);

    // Register agent3 to trigger a notification
    await agent1.callTool("register", { name: AGENT_3_NAME });

    const events = await sse.waitForEvents(1);
    sse.close();

    assert.strictEqual(events.length > 0, true);

    const eventJson = parseJson(events[0]);

    // Verify JSON-RPC envelope
    assert.strictEqual(eventJson.jsonrpc, JSON_RPC_VERSION);
    assert.strictEqual(eventJson.method, NOTIFICATION_METHOD);

    // Verify params structure
    const params = eventJson.params as Record<string, unknown>;
    assert.strictEqual(params.level, LEVEL_INFO);

    // Verify data structure
    const data = params.data as Record<string, unknown>;
    assert.strictEqual("event" in data, true);
    assert.strictEqual("payload" in data, true);
    assert.strictEqual("timestamp" in data, true);
    assert.strictEqual(data.event, EVENT_AGENT_REGISTERED);
  });
});
