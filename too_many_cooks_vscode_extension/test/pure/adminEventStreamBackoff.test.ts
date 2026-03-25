// Test: AdminEventStream reconnect loop MUST use exponential backoff.
//
// BUG: When the server becomes unreachable after a successful init,
// AdminEventStream reconnects every 200ms with no backoff, grinding
// ~5 retries/second and flooding logs. Each reconnect also fires
// onEvent(), triggering a refreshStatus() that also fails.
//
// EXPECTED: Reconnect delays MUST increase exponentially on consecutive
// failures. onEvent() MUST NOT fire on failed reconnects.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import * as http from 'node:http';
import { startAdminEventStream } from '../../src/services/adminEventStream';

const TEST_SESSION_ID: string = 'test-session-backoff-001';
const MCP_SESSION_HEADER: string = 'mcp-session-id';
const OBSERVE_WINDOW_MS: number = 6000;
const TEST_TIMEOUT_MS: number = 10000;
const MAX_RECONNECTS_ALLOWED: number = 12;
const MIN_RECONNECTS_FOR_BACKOFF_CHECK: number = 3;

/** Minimal MCP server: init succeeds, then GET /admin/events always fails. */
async function createFlakyServer(): Promise<{ server: http.Server; port: number }> {
  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      if (req.method === 'POST') {
        // Handle init + notifications/initialized — return session ID
        res.setHeader(MCP_SESSION_HEADER, TEST_SESSION_ID);
        res.setHeader('content-type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          result: {
            capabilities: {},
            protocolVersion: '2025-03-26',
            serverInfo: { name: 'test', version: '1.0.0' },
          },
        }));
        return;
      }
      // GET /admin/events — immediately close with error to force reconnect
      res.writeHead(503);
      res.end('Service Unavailable');
    },
  );

  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port: number = typeof address === 'object' && address !== null ? address.port : 0;

  return { port, server };
}

let serverToCleanup: http.Server | null = null;
let abortToCleanup: AbortController | null = null;

afterEach((): void => {
  abortToCleanup?.abort();
  abortToCleanup = null;
  if (serverToCleanup !== null) {
    serverToCleanup.close();
    serverToCleanup = null;
  }
});

describe('AdminEventStream exponential backoff', () => {
  it('reconnect loop backs off exponentially when stream repeatedly fails', { timeout: TEST_TIMEOUT_MS }, async () => {
    const { server, port } = await createFlakyServer();
    serverToCleanup = server;

    const baseUrl: string = `http://127.0.0.1:${String(port)}`;
    const reconnectTimestamps: number[] = [];
    let eventCallCount: number = 0;
    const abortController: AbortController = new AbortController();
    abortToCleanup = abortController;

    await startAdminEventStream(abortController, {
      baseUrl,
      log: (msg: string): void => {
        if (msg.includes('Reconnecting')) {
          reconnectTimestamps.push(Date.now());
        }
      },
      onEvent: (): void => {
        eventCallCount += 1;
      },
    });

    // Observe reconnect behavior for OBSERVE_WINDOW_MS
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, OBSERVE_WINDOW_MS);
    });

    abortController.abort();
    abortToCleanup = null;
    server.close();
    serverToCleanup = null;

    // Allow settle
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 300);
    });

    console.log(`[TEST] Reconnect count in ${String(OBSERVE_WINDOW_MS)}ms: ${String(reconnectTimestamps.length)}`);
    for (let i: number = 1; i < reconnectTimestamps.length; i += 1) {
      const prev: number | undefined = reconnectTimestamps[i - 1];
      const curr: number | undefined = reconnectTimestamps[i];
      if (prev !== undefined && curr !== undefined) {
        console.log(`[TEST]   gap #${String(i)}: ${String(curr - prev)}ms`);
      }
    }
    console.log(`[TEST] onEvent calls during failures: ${String(eventCallCount)}`);

    // With fixed 200ms delay (the bug), in 6 seconds we'd get ~30 reconnects.
    // With exponential backoff (200, 400, 800, 1600, 3200ms), we'd get ~6 in 6s.
    assert.ok(
      reconnectTimestamps.length <= MAX_RECONNECTS_ALLOWED,
      `Too many reconnects: ${String(reconnectTimestamps.length)} in ${String(OBSERVE_WINDOW_MS)}ms ` +
      `(max ${String(MAX_RECONNECTS_ALLOWED)}). Reconnect loop lacks exponential backoff.`,
    );

    // Verify gaps are increasing (backoff is working)
    if (reconnectTimestamps.length >= MIN_RECONNECTS_FOR_BACKOFF_CHECK) {
      const first: number | undefined = reconnectTimestamps[0];
      const second: number | undefined = reconnectTimestamps[1];
      const lastIdx: number = reconnectTimestamps.length - 1;
      const secondLast: number | undefined = reconnectTimestamps[lastIdx - 1];
      const last: number | undefined = reconnectTimestamps[lastIdx];
      if (first !== undefined && second !== undefined && secondLast !== undefined && last !== undefined) {
        const firstGap: number = second - first;
        const lastGap: number = last - secondLast;
        assert.ok(
          lastGap > firstGap,
          `Reconnect gaps not increasing: first=${String(firstGap)}ms, last=${String(lastGap)}ms. ` +
          `Exponential backoff is not working.`,
        );
      }
    }
  });
});
