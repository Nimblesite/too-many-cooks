/// Regression test: message_sent notifications must only be delivered
/// to the recipient agent, not to all agents.
///
/// Bug: currently emitter.emit(eventMessageSent, ...) broadcasts to ALL
/// agents regardless of who the message is addressed to.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { SERVER_BINARY, SERVER_NODE_ARGS } from "../lib/src/config.js";

const TEST_PORT = 4045;
const BASE_URL = `http://localhost:${String(TEST_PORT)}`;
const MCP_PATH = "/mcp";
const ACCEPT = "application/json, text/event-stream";
const MCP_PROTOCOL_VERSION = "2025-03-26";
const STREAM_ESTABLISH_DELAY_MS = 300;
const EVENT_TIMEOUT_MS = 1500;
const EVENT_POLL_DELAY_MS = 50;
const DB_DIR = ".too_many_cooks";
const DB_FILES = ["data.db", "data.db-wal", "data.db-shm"];

// ============================================================
// Helpers
// ============================================================

const parseJson = (text: string): Record<string, unknown> =>
  JSON.parse(text) as Record<string, unknown>;

const extractEventType = (sseData: string): string | undefined => {
  const json = parseJson(sseData);
  const params = json.params as Record<string, unknown> | undefined;
  const data = params?.data as Record<string, unknown> | undefined;
  return data?.event as string | undefined;
};

class AgentSseClient {
  private readonly events: string[] = [];
  private consumed = 0;
  private controller: AbortController | undefined;

  static async connect(sessionId: string): Promise<AgentSseClient> {
    const client = new AgentSseClient();
    client.controller = new AbortController();
    const signal = client.controller.signal;

    void (async () => {
      try {
        const response = await fetch(`${BASE_URL}${MCP_PATH}`, {
          method: "GET",
          headers: {
            Accept: ACCEPT,
            "mcp-session-id": sessionId,
          },
          signal,
        });
        if (!response.ok) {return;}
        const body = response.body;
        if (body === null) {return;}
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) {break;}
          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.substring(6).trim();
              if (data.length > 0) {client.events.push(data);}
            }
          }
        }
      } catch {
        // aborted - expected
      }
    })();

    await new Promise((resolve) =>
      setTimeout(resolve, STREAM_ESTABLISH_DELAY_MS),
    );
    return client;
  }

  async waitForEvents(
    count: number,
    timeoutMs: number = EVENT_TIMEOUT_MS,
  ): Promise<string[]> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.events.length - this.consumed >= count) {
        const result = this.events.slice(this.consumed);
        this.consumed = this.events.length;
        return result;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, EVENT_POLL_DELAY_MS),
      );
    }
    const result = this.events.slice(this.consumed);
    this.consumed = this.events.length;
    return result;
  }

  close(): void {
    this.controller?.abort();
  }
}

class McpClient {
  private sessionId = "";
  private nextId = 1;

  getSessionId(): string {
    if (this.sessionId === "") {
      throw new Error("Session not initialized");
    }
    return this.sessionId;
  }

  async initSession(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "msg-filter-test", version: "1.0" },
    });
    if (this.sessionId === "") {
      throw new Error("No session ID after init");
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
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      params,
    });
    const response = await this.postMcp(body);
    const text = await response.text();
    const json = this.parseMcpResponse(text);
    if ("error" in json && json.error !== undefined) {
      const errorObj = json.error as Record<string, unknown>;
      const msg = (errorObj.message as string | undefined) ?? "Error";
      return {
        isError: true,
        content: [{ type: "text", text: msg }],
      };
    }
    return json.result as Record<string, unknown>;
  }

  private async postMcp(body: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: ACCEPT,
    };
    if (this.sessionId !== "") {
      headers["mcp-session-id"] = this.sessionId;
    }
    const response = await fetch(`${BASE_URL}${MCP_PATH}`, {
      method: "POST",
      headers,
      body,
    });
    const sid = response.headers.get("mcp-session-id");
    if (sid !== null) {
      this.sessionId = sid;
    }
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

const spawnServer = (): ChildProcess =>
  spawn("node", [...SERVER_NODE_ARGS, SERVER_BINARY], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, TMC_PORT: String(TEST_PORT) },
  });

const killProcess = (proc: ChildProcess): void => {
  proc.kill();
};

const waitForServer = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE_URL}/admin/status`);
      if (r.ok) {return;}
    } catch {
      // not ready
    }
    if (i === 29) {throw new Error("Server failed to start");}
    await new Promise((resolve) => setTimeout(resolve, 200));
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
      if (existsSync(path)) {unlinkSync(path);}
    } catch {
      // ignore
    }
  }
};

describe("message filtering", () => {
  let serverProcess: ChildProcess;

  before(async () => {
    deleteDbFiles();
    serverProcess = spawnServer();
    await waitForServer();
  });

  after(() => {
    killProcess(serverProcess);
    deleteDbFiles();
  });

  beforeEach(async () => {
    await resetServer();
  });

  it("message_sent is NOT delivered to agent that is not the recipient", async () => {
    // Three agents: sender, recipient, bystander.
    // sender sends to recipient.
    // bystander MUST NOT receive the message_sent notification.
    const sender = new McpClient();
    const recipient = new McpClient();
    const bystander = new McpClient();
    await sender.initSession();
    await recipient.initSession();
    await bystander.initSession();

    const senderReg = parseJson(
      await sender.callTool("register", { name: "sender" }),
    );
    await recipient.callTool("register", { name: "recipient" });
    await bystander.callTool("register", { name: "bystander" });

    const senderKey = senderReg.agent_key as string;

    // Open SSE streams AFTER registration to avoid buffered events.
    const recipientSse = await AgentSseClient.connect(
      recipient.getSessionId(),
    );
    const bystanderSse = await AgentSseClient.connect(
      bystander.getSessionId(),
    );

    // Send a message from sender to recipient only.
    await sender.callTool("message", {
      action: "send",
      agent_key: senderKey,
      to_agent: "recipient",
      content: "hello recipient",
    });

    const recipientEvents = await recipientSse.waitForEvents(1);
    const bystanderEvents = await bystanderSse.waitForEvents(1);

    recipientSse.close();
    bystanderSse.close();

    // Recipient MUST get a message_sent notification.
    assert.strictEqual(
      recipientEvents.length > 0,
      true,
      "recipient MUST receive message_sent notification",
    );
    const recipientEventType = extractEventType(recipientEvents[0]!);
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
    const sender = new McpClient();
    const agent2 = new McpClient();
    await sender.initSession();
    await agent2.initSession();

    const senderReg = parseJson(
      await sender.callTool("register", { name: "sender-b" }),
    );
    await agent2.callTool("register", { name: "agent2-b" });

    const senderKey = senderReg.agent_key as string;

    const agent2Sse = await AgentSseClient.connect(agent2.getSessionId());

    await sender.callTool("message", {
      action: "send",
      agent_key: senderKey,
      to_agent: "*",
      content: "broadcast!",
    });

    const events = await agent2Sse.waitForEvents(1);
    agent2Sse.close();

    assert.strictEqual(
      events.length > 0,
      true,
      "agent2 MUST receive broadcast message_sent",
    );
    assert.strictEqual(
      extractEventType(events[0]!),
      "message_sent",
      "event type MUST be message_sent",
    );
  });
});
