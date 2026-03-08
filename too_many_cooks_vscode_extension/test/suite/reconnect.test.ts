// Reconnection test: callTool MUST recover from a stale MCP session.
//
// BUG: When the server restarts, the VSIX's cached MCP session ID
// becomes stale. callTool catches the error and clears the session,
// but does NOT retry. The user sees an error and must manually retry.
// Every action MUST transparently reconnect on stale session.

import {
  waitForExtensionActivation,
  waitForConnection,
  safeDisconnect,
  getTestAPI,
  callToolString,
  resetServerState,
  assertOk,
} from './testHelpers';

suite('Reconnection - stale MCP session recovery', () => {
  suiteSetup(async () => {
    await waitForExtensionActivation();
    const api = getTestAPI();
    if (!api.isConnected()) {
      await api.connect();
      await waitForConnection();
    }
    await resetServerState();
  });

  suiteTeardown(async () => {
    await safeDisconnect();
  });

  test('callTool succeeds after MCP session is stale', async () => {
    const api = getTestAPI();

    // 1. Call a tool — establishes MCP session
    const first = await callToolString(api, 'status', {});
    assertOk(
      !first.includes('"error"'),
      `First call must succeed, got: ${first}`,
    );

    // 2. Corrupt the cached session ID (simulates server restart)
    api.invalidateMcpSession();

    // 3. Call a tool again — MUST succeed transparently.
    //    Currently FAILS: callTool returns error string
    //    instead of retrying with a fresh session.
    const second = await callToolString(api, 'status', {});
    assertOk(
      !second.includes('"error"'),
      `Call after stale session MUST succeed (auto-reconnect), got: ${second}`,
    );
  });
});
