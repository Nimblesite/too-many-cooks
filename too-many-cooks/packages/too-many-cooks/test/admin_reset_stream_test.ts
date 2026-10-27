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


import { describe, it } from 'node:test';
import assert from 'node:assert';

import { buildBaseUrl, resetServerViaAdmin } from './support/server_process.js';
import { clientFactory, type ClientInfo } from './support/mcp_http.js';
import { type SseEventCollector, extractEventType } from './support/sse.js';
import {
  bindSpawnedServer,
  connectAdminEventsStream,
  eventWaiter,
  firstStreamEvent,
} from './support/streaming.js';

const TEST_PORT = 4047;
const BASE_URL = buildBaseUrl(TEST_PORT);
const EVENT_TIMEOUT_MS = 2000;
const TMP_PREFIX = '/tmp/tmc-admin-reset-stream-';
const EVENT_AGENT_REGISTERED = 'agent_registered';

const ADMIN_CLIENT_INFO: ClientInfo = { name: 'admin-reset-stream-test', version: '1.0.0' };
const MCP_CLIENT_INFO: ClientInfo = { name: 'admin-reset-mcp', version: '1.0.0' };

// ============================================================
// Helpers
// ============================================================

/** Opens the admin GET /admin/events notification stream. */
const connectAdminStream = async (): Promise<SseEventCollector> =>
  connectAdminEventsStream(BASE_URL, ADMIN_CLIENT_INFO);

/** Waits for events with this suite's timeout budget. */
const waitForEvents = eventWaiter(EVENT_TIMEOUT_MS);

const newMcpClient = clientFactory(BASE_URL, MCP_CLIENT_INFO);

// ============================================================
// Tests
// ============================================================

describe('admin_reset_stream_test', () => {
  bindSpawnedServer(TEST_PORT, TMP_PREFIX, BASE_URL);

  it('admin stream receives events AFTER /admin/reset', async () => {
    // 1. Open admin stream (like VSIX does on connect)
    const stream = await connectAdminStream();

    // 2. Reset server (like VSIX streaming test suiteSetup)
    await resetServerViaAdmin(BASE_URL);

    // 3. Consume any events from the reset itself
    //    (state_reset is sent BEFORE hub.servers is cleared)
    await waitForEvents(stream, 1);

    // 4. Create MCP session and register agent AFTER reset
    const mcpClient = newMcpClient();
    await mcpClient.initSession();
    await mcpClient.callTool('register', { name: 'post-reset-agent' });

    // 5. ASSERT: stream MUST still receive the
    //    agent_registered event (sent AFTER reset cleared
    //    hub.servers). This is the bug: after reset clears
    //    hub.servers, pushEvent iterates an empty map and
    //    delivers nothing.
    assert.strictEqual(
      extractEventType(await firstStreamEvent(stream, EVENT_TIMEOUT_MS)),
      EVENT_AGENT_REGISTERED,
    );
  });
});
