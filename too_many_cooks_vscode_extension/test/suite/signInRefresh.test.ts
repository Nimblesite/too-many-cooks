// BUG: VSIX tree does not update after an external agent signs in (registers).
//
// REPRO (from screenshot): I (Coordinator) registered on TMC via direct MCP call.
// The server showed 3 agents registered and pushed agent_registered events to all
// admin SSE sessions. Yet the VSIX panel showed NO agents — empty AGENTS tree,
// "No locks", "No messages". The tree never refreshed after sign-in.
//
// ROOT CAUSE: The admin event stream (adminEventStream.ts) has NO reconnect logic.
// When the server closes the SSE connection (server restart, idle timeout, network
// blip), readEventStream() exits and the VSIX permanently stops receiving events.
// Subsequent agent registrations are never seen. The tree stays permanently stale.
//
// HOW THE TEST REPRODUCES THE BUG:
//   1. Connect VSIX (admin SSE established)
//   2. Verify SSE works: register via direct HTTP, agent appears in tree
//   3. api.invalidateEventStream() — kills the SSE without disconnecting.
//      This simulates the server closing the SSE connection.
//      isConnected() is still true, but no events are received.
//   4. Register another agent via direct HTTP (server pushes event, nobody receives it)
//   5. Assert the agent appears in tree → TIMES OUT → TEST FAILS
//
// The test MUST FAIL until reconnect logic is added to adminEventStream.ts.

import {
  assertOk,
  directToolCall,
  initDirectMcpSession,
  MCP_ENDPOINT,
  dumpTree,
  ensureServerReady,
  extractKeyFromResult,
  getTestAPI,
  restoreDialogMocks,
  safeDisconnect,
  waitForAgentInTree,
  waitForCondition,
} from './testHelpers';

restoreDialogMocks();

const TEST_PORT = process.env.TMC_PORT ?? '4040';
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Direct MCP session that bypasses the VSIX's callTool (which calls refreshStatus).
// The ONLY way the VSIX tree can update after directRegister() is via the admin event stream.
const DIRECT_CLIENT_NAME = 'sign-in-refresh-test';

async function initDirectSession(): Promise<string> {
  return await initDirectMcpSession(BASE_URL, MCP_ENDPOINT, DIRECT_CLIENT_NAME);
}

async function directRegister(sessionId: string, agentName: string): Promise<string> {
  const result = await directToolCall(BASE_URL, sessionId, 'register', { name: agentName });
  return extractKeyFromResult(result);
}

suite('BUG: VSIX tree does not update after SSE stream closes (no reconnect)', () => {
  const testId = Date.now();
  let sessionId = '';

  suiteSetup(async () => {
    await ensureServerReady();
    await waitForCondition(
      () => getTestAPI().getAgentCount() === 0,
      'Store to clear after reset',
    );
    sessionId = await initDirectSession();
  });

  suiteTeardown(async () => {
    await safeDisconnect();
  });

  // =========================================================================
  // PHASE 1: Confirm the SSE stream works normally (baseline)
  // =========================================================================

  test('BASELINE: SSE stream delivers agent registration before stream dies', async () => {
    const api = getTestAPI();
    const agentName = `baseline-${testId}`;

    const key = await directRegister(sessionId, agentName);
    assertOk(key.length > 0, 'Registration must return a key');

    // SSE stream is alive — event MUST arrive and tree MUST update
    await waitForAgentInTree(api, agentName);

    assertOk(
      api.findAgentInTree(agentName),
      `Baseline FAILED: ${agentName} must appear via SSE stream`,
    );
  });

  // =========================================================================
  // PHASE 2: Kill the SSE stream (simulates server closing the connection)
  // Then verify that sign-in events are LOST — this is the BUG.
  // =========================================================================

  test('BUG: After SSE stream dies, external agent sign-in does NOT appear in tree', async () => {
    const api = getTestAPI();

    // Kill the admin SSE stream without disconnecting.
    // isConnected() stays true — exactly like a server-side connection close.
    // BUG: No reconnect logic exists. Events pushed after this are permanently lost.
    api.invalidateEventStream();

    const agentName = `signin-after-sse-death-${testId}`;
    const key = await directRegister(sessionId, agentName);
    assertOk(key.length > 0, 'Registration must return a key from server');

    console.log(`[BUG TEST] ${agentName} registered. SSE stream is dead. Waiting for tree update...`);
    console.log(`[BUG TEST] isConnected()=${String(api.isConnected())} — still true (bug condition)`);

    // BUG: The server pushed agent_registered, but the VSIX never received it.
    // waitForAgentInTree will TIME OUT because the SSE stream is dead.
    // This is the exact scenario from the screenshot: agent registered, VSIX shows nothing.
    await waitForAgentInTree(api, agentName);

    dumpTree('AGENTS after sign-in with dead SSE', api.getAgentsTreeSnapshot());

    assertOk(
      api.findAgentInTree(agentName),
      `BUG CONFIRMED: ${agentName} never appeared in VSIX tree after signing in. ` +
      `The admin event stream died and was NOT reconnected. ` +
      `This is the exact bug from the screenshot — Coordinator registered, ` +
      `VSIX showed no agents. Fix: add reconnect logic to adminEventStream.ts.`,
    );
  });
});
