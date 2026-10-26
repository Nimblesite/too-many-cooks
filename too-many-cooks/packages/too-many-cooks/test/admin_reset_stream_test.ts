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


import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import type { ChildProcess } from 'node:child_process';

import {
  type SpawnedServer,
  killServer,
  resetServerViaAdmin,
  spawnServer,
  waitForServer,
} from './support/server_process.js';
import {
  ACCEPT_STREAMABLE,
  ADMIN_EVENTS_PATH,
  McpHttpClient,
  initAdminEventsSession,
  type ClientInfo,
} from './support/mcp_http.js';
import { SseEventCollector, extractEventType } from './support/sse.js';
import { removeTree } from './support/fs_helpers.js';

const TEST_PORT = 4047;
const BASE_URL = `http://localhost:${String(TEST_PORT)}`;
const EVENT_TIMEOUT_MS = 2000;
const TMP_PREFIX = '/tmp/tmc-admin-reset-stream-';

const ADMIN_CLIENT_INFO: ClientInfo = { name: 'admin-reset-stream-test', version: '1.0.0' };
const MCP_CLIENT_INFO: ClientInfo = { name: 'admin-reset-mcp', version: '1.0.0' };

// ============================================================
// Helpers
// ============================================================

/** Opens the admin GET /admin/events notification stream. */
const connectAdminStream = async (): Promise<SseEventCollector> => {
  const sessionId = await initAdminEventsSession(BASE_URL, ADMIN_CLIENT_INFO);
  return SseEventCollector.open({
    url: `${BASE_URL}${ADMIN_EVENTS_PATH}`,
    headers: { Accept: ACCEPT_STREAMABLE, 'mcp-session-id': sessionId },
  });
};

const newMcpClient = (): McpHttpClient =>
  new McpHttpClient({ baseUrl: BASE_URL, clientInfo: MCP_CLIENT_INFO });

let spawned: SpawnedServer | undefined;

// ============================================================
// Tests
// ============================================================

describe('admin_reset_stream_test', () => {
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

  it('admin stream receives events AFTER /admin/reset', async () => {
    // 1. Open admin stream (like VSIX does on connect)
    const stream = await connectAdminStream();

    // 2. Reset server (like VSIX streaming test suiteSetup)
    await resetServerViaAdmin(BASE_URL);

    // 3. Consume any events from the reset itself
    //    (state_reset is sent BEFORE hub.servers is cleared)
    await stream.waitForEvents(1, EVENT_TIMEOUT_MS);

    // 4. Create MCP session and register agent AFTER reset
    const mcpClient = newMcpClient();
    await mcpClient.initSession();
    await mcpClient.callTool('register', { name: 'post-reset-agent' });

    // 5. ASSERT: stream MUST still receive the
    //    agent_registered event (sent AFTER reset cleared
    //    hub.servers). This is the bug: after reset clears
    //    hub.servers, pushEvent iterates an empty map and
    //    delivers nothing.
    const events = await stream.waitForEvents(1, EVENT_TIMEOUT_MS);
    stream.close();

    assert.strictEqual(
      events.length > 0,
      true,
    );

    // Verify it's an agent_registered event
    assert.strictEqual(
      extractEventType(events[0] ?? ''),
      'agent_registered',
    );
  });
});
