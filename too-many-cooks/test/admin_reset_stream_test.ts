/// Test: admin stream survives /admin/reset.
///
/// BUG: /admin/reset clears hub.servers and hub.transports,
/// which kills the admin event push for any connected
/// VSIX clients. After reset, no admin events are delivered
/// via Streamable HTTP until the client reconnects.
///
/// This test proves that an admin stream established
/// BEFORE a reset continues to receive events AFTER the
/// reset — exactly like the VSIX extension's lifecycle.


import { describe, it, before, after } from "node:test";
import assert from "node:assert";

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

import { SERVER_BINARY, SERVER_NODE_ARGS } from '../lib/src/config.js';

const TEST_PORT = 4047;
const BASE_URL = `http://localhost:${String(TEST_PORT)}` as const;
const ACCEPT = 'application/json, text/event-stream' as const;
const ADMIN_EVENTS_PATH = '/admin/events' as const;
const MCP_PROTOCOL_VERSION = '2025-03-26' as const;
const EVENT_TIMEOUT_MS = 2000;
const STREAM_SETTLE_MS = 200;
const POLL_INTERVAL_MS = 50;

// ============================================================
// Helper: sleep
// ============================================================

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================
// Helper: spawn server
// ============================================================

let tmpWorkspace = '';

const spawnServer = (): ChildProcess => {
  tmpWorkspace = fs.mkdtempSync('/tmp/tmc-admin-reset-stream-');
  return spawn('node', [...SERVER_NODE_ARGS, SERVER_BINARY], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, TMC_PORT: String(TEST_PORT), TMC_WORKSPACE: tmpWorkspace },
  });
};

// ============================================================
// Helper: wait for server
// ============================================================

const waitForServer = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE_URL}/admin/status`);
      if (r.ok) {return;}
    } catch {
      // Not ready yet
    }
    if (i === 29) {throw new Error('Server failed to start');}
    await sleep(200);
  }
};

// ============================================================
// Helper: reset server
// ============================================================

const resetServer = async (): Promise<void> => {
  const r = await fetch(`${BASE_URL}/admin/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!r.ok) {
    throw new Error('Failed to reset server');
  }
};

// ============================================================
// Admin Stream Client
// ============================================================

const initAdminSession = async (): Promise<string> => {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'admin-reset-stream-test', version: '1.0.0' },
    },
  });

  const response = await fetch(`${BASE_URL}${ADMIN_EVENTS_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: ACCEPT,
    },
    body,
  });

  const sessionId = response.headers.get('mcp-session-id');
  if (sessionId === null) {
    throw new Error('No admin session ID');
  }

  const notifyBody = JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  });
  await fetch(`${BASE_URL}${ADMIN_EVENTS_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: ACCEPT,
      'mcp-session-id': sessionId,
    },
    body: notifyBody,
  });

  return sessionId;
};

class AdminStreamClient {
  private readonly events: string[] = [];
  private consumed = 0;
  private controller: AbortController | undefined;

  static async connect(): Promise<AdminStreamClient> {
    const sessionId = await initAdminSession();
    const client = new AdminStreamClient();
    client.controller = new AbortController();

    const headers: Record<string, string> = {
      Accept: ACCEPT,
      'mcp-session-id': sessionId,
    };

    void (async () => {
      try {
        const response = await fetch(`${BASE_URL}${ADMIN_EVENTS_PATH}`, {
          method: 'GET',
          headers,
          signal: client.controller!.signal,
        });
        if (!response.ok || response.body === null) {return;}

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) {break;}

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          for (const line of lines) {
            if (line.startsWith('data: ')) {
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

    await sleep(STREAM_SETTLE_MS);
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
      await sleep(POLL_INTERVAL_MS);
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
// MCP Client
// ============================================================

class McpClient {
  private sessionId: string | undefined;
  private nextId = 1;

  async initSession(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'admin-reset-mcp', version: '1.0.0' },
    });
    if (this.sessionId === undefined) {
      throw new Error('No session ID after init');
    }
    await this.postMcp(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      }),
    );
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const result = await this.request('tools/call', {
      name,
      arguments: args,
    });
    const content = (
      result.content as Array<Record<string, unknown>>
    )[0];
    return content.text as string;
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });
    const response = await this.postMcp(body);
    const text = await response.text();
    const json = this.parseMcpResponse(text);
    if ('error' in json) {
      const err = json.error as Record<string, unknown>;
      const message = (err.message as string | undefined) ?? 'Error';
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
    return json.result as Record<string, unknown>;
  }

  private async postMcp(body: string): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: ACCEPT,
    };
    if (this.sessionId !== undefined) {
      headers['mcp-session-id'] = this.sessionId;
    }
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers,
      body,
    });
    const sid = response.headers.get('mcp-session-id');
    if (sid !== null) {this.sessionId = sid;}
    return response;
  }

  private parseMcpResponse(text: string): Record<string, unknown> {
    if (text.trimStart().startsWith('{')) {
      return JSON.parse(text) as Record<string, unknown>;
    }
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
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
// Tests
// ============================================================

describe('admin_reset_stream_test', () => {
  let serverProcess: ChildProcess;

  before(async () => {
    serverProcess = spawnServer();
    await waitForServer();
  });

  after(() => {
    serverProcess.kill();
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  it('admin stream receives events AFTER /admin/reset', async () => {
    // 1. Open admin stream (like VSIX does on connect)
    const stream = await AdminStreamClient.connect();

    // 2. Reset server (like VSIX streaming test suiteSetup)
    await resetServer();

    // 3. Consume any events from the reset itself
    //    (state_reset is sent BEFORE hub.servers is cleared)
    await stream.waitForEvents(1);

    // 4. Create MCP session and register agent AFTER reset
    const mcpClient = new McpClient();
    await mcpClient.initSession();
    await mcpClient.callTool('register', { name: 'post-reset-agent' });

    // 5. ASSERT: stream MUST still receive the
    //    agent_registered event (sent AFTER reset cleared
    //    hub.servers). This is the bug: after reset clears
    //    hub.servers, pushEvent iterates an empty map and
    //    delivers nothing.
    const events = await stream.waitForEvents(1);
    stream.close();

    assert.strictEqual(
      events.length > 0,
      true,
    );

    // Verify it's an agent_registered event
    const eventJson = JSON.parse(events[0]) as Record<string, unknown>;
    const params = eventJson.params as
      | Record<string, unknown>
      | undefined;
    const data = params?.data as Record<string, unknown> | undefined;
    assert.strictEqual(data?.event, 'agent_registered');
  });
});
