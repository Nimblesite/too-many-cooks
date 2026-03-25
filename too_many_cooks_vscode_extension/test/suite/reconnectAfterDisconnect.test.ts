// Reconnection test: actions MUST auto-reconnect when disconnected.
//
// BUG: When the VSIX loses its connection to the HTTP server,
// refreshStatus() and callTool() immediately throw/return "Not connected"
// without attempting to reconnect. The user must manually reconnect.
// Every action should attempt to reconnect if the server is available.

import {
  waitForExtensionActivation,
  waitForConnection,
  safeDisconnect,
  getTestAPI,
  callToolString,
  resetServerState,
  assertOk,
} from './testHelpers';

suite('Reconnection - auto-reconnect after disconnect', () => {
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

  test('refreshStatus auto-reconnects when server is available', async () => {
    const api = getTestAPI();

    // 1. Verify we're connected and refresh works
    await api.refreshStatus();
    assertOk(api.isConnected(), 'Should be connected initially');

    // 2. Disconnect — simulates lost connection
    await api.disconnect();
    assertOk(!api.isConnected(), 'Should be disconnected after disconnect()');

    // 3. refreshStatus MUST auto-reconnect since server is still running.
    //    Currently FAILS: throws "Not connected" without trying to reconnect.
    await api.refreshStatus();
    assertOk(
      api.isConnected(),
      'Should be reconnected after refreshStatus auto-reconnect',
    );
  });

  test('callTool auto-reconnects when server is available', async () => {
    const api = getTestAPI();

    // 1. Ensure connected
    if (!api.isConnected()) {
      await api.connect();
      await waitForConnection();
    }

    // 2. Disconnect
    await api.disconnect();
    assertOk(!api.isConnected(), 'Should be disconnected');

    // 3. callTool MUST auto-reconnect and succeed.
    //    Currently FAILS: returns {"error":"Not connected"} immediately.
    const result = await callToolString(api, 'status', {});
    assertOk(
      !result.includes('"error"'),
      `callTool should auto-reconnect and succeed, got: ${result}`,
    );
    assertOk(
      api.isConnected(),
      'Should be reconnected after callTool auto-reconnect',
    );
  });
});
