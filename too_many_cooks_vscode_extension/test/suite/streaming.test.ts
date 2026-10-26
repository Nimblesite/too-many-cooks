// Streaming Tests - PROVE that MCP server streams ALL changes to the VSIX.
// These tests bypass the VSIX's callTool (which calls refreshStatus internally)
// and instead call the MCP server directly via HTTP. The ONLY way tree views
// update is via the admin event stream. NO POLLING. NO MANUAL REFRESH.

import {
  MCP_ENDPOINT,
  assertEqual,
  assertOk,
  directToolCall,
  dumpTree,
  ensureServerReady,
  extractKeyFromResult,
  getLabel,
  getTestAPI,
  hasChildWithLabel,
  initDirectMcpSession,
  requireTreeItem,
  restoreDialogMocks,
  safeDisconnect,
  waitForAgentInTree,
  waitForCondition,
  waitForConnection,
  waitForLockGone,
  waitForLockInTree,
  waitForMessageInTree,
} from './testHelpers';

restoreDialogMocks();

// Direct MCP server call - bypasses VSIX callTool and its refreshStatus().
// The ONLY way the tree can update is via the admin event stream.
const TEST_PORT = process.env.TMC_PORT ?? '4040';
const BASE_URL = `http://localhost:${TEST_PORT}`;

const DIRECT_CLIENT_NAME = 'streaming-test-direct';

suite('Streaming - MCP Server Pushes ALL Changes to VSIX', () => {
  let directSession: string;

  async function acquireLockDirect(
    agentKey: string,
    agentName: string,
    filePath: string,
    reason: string,
  ): Promise<void> {
    await directToolCall(BASE_URL, directSession, 'lock', {
      action: 'acquire',
      agent_key: agentKey,
      agent_name: agentName,
      file_path: filePath,
      reason,
    });
    await waitForLockInTree(getTestAPI(), filePath);
  }
  let agent1Key = '';
  let agent2Key = '';
  const testId = Date.now();
  const agent1Name = `stream-agent-${testId}-1`;
  const agent2Name = `stream-agent-${testId}-2`;

  suiteSetup(async () => {
    await ensureServerReady();
    // Reset pushes an event — wait for store to clear via streaming
    await waitForCondition(
      () => getTestAPI().getAgentCount() === 0,
      'Store to clear after reset',
    );
    directSession = await initDirectMcpSession(BASE_URL, MCP_ENDPOINT, DIRECT_CLIENT_NAME);
  });

  suiteTeardown(async () => {
    await safeDisconnect();
  });

  // =========================================================================
  // AGENT REGISTRATION - streamed to VSIX tree
  // =========================================================================

  test('STREAM: Register agent via direct HTTP → agent APPEARS in tree WITHOUT refreshStatus', async () => {
    const result = await directToolCall(BASE_URL, directSession, 'register', { name: agent1Name });
    agent1Key = extractKeyFromResult(result);
    assertOk(agent1Key.length > 0, 'Should return agent key');

    // DO NOT call refreshStatus. The event stream MUST push this.
    await waitForAgentInTree(getTestAPI(), agent1Name);

    const agentItem = getTestAPI().findAgentInTree(agent1Name);
    assertOk(agentItem, `${agent1Name} MUST appear in tree via streaming`);
    assertEqual(getLabel(requireTreeItem(agentItem, 'agentItem must exist')), agent1Name, 'Label must match agent name');
  });

  test('STREAM: Register second agent via direct HTTP → both agents visible', async () => {
    const result = await directToolCall(BASE_URL, directSession, 'register', { name: agent2Name });
    agent2Key = extractKeyFromResult(result);

    await waitForCondition(
      () => getTestAPI().getAgentsTreeSnapshot().length >= 2,
      '2 agents in tree via streaming',
    );

    assertOk(getTestAPI().findAgentInTree(agent1Name), `${agent1Name} MUST still be in tree`);
    assertOk(getTestAPI().findAgentInTree(agent2Name), `${agent2Name} MUST be in tree via streaming`);
  });

  // =========================================================================
  // LOCK OPERATIONS - streamed to VSIX tree
  // =========================================================================

  test('STREAM: Acquire lock via direct HTTP → lock APPEARS in locks tree', async () => {
    await acquireLockDirect(agent1Key, agent1Name, '/stream/test.ts', 'Streaming test');

    const lockItem = getTestAPI().findLockInTree('/stream/test.ts');
    dumpTree('LOCKS after streamed acquire', getTestAPI().getLocksTreeSnapshot());
    assertOk(lockItem, '/stream/test.ts MUST appear in locks tree via streaming');
  });

  test('STREAM: Acquire second lock → both locks visible in tree', async () => {
    await acquireLockDirect(agent2Key, agent2Name, '/stream/utils.ts', 'Streaming test 2');

    assertOk(getTestAPI().findLockInTree('/stream/test.ts'), '/stream/test.ts MUST still be in tree');
    assertOk(getTestAPI().findLockInTree('/stream/utils.ts'), '/stream/utils.ts MUST be in tree via streaming');
  });

  test('STREAM: Release lock via direct HTTP → lock DISAPPEARS from tree', async () => {
    await directToolCall(BASE_URL, directSession, 'lock', {
      action: 'release',
      agent_key: agent1Key,
      agent_name: agent1Name,
      file_path: '/stream/test.ts',
    });

    await waitForLockGone(getTestAPI(), '/stream/test.ts');

    assertEqual(getTestAPI().findLockInTree('/stream/test.ts'), null, '/stream/test.ts MUST NOT be in tree');
    assertOk(getTestAPI().findLockInTree('/stream/utils.ts'), '/stream/utils.ts MUST still be in tree');
  });

  // =========================================================================
  // PLAN UPDATES - streamed to VSIX tree
  // =========================================================================

  test('STREAM: Update plan via direct HTTP → plan APPEARS in agent children', async () => {
    await directToolCall(BASE_URL, directSession, 'plan', {
      action: 'update',
      agent_key: agent1Key,
      agent_name: agent1Name,
      current_task: 'Proving streaming works',
      goal: 'Stream all the things',
    });

    await waitForCondition(() => {
      const agentItem = getTestAPI().findAgentInTree(agent1Name);
      if (!agentItem) { return false; }
      return hasChildWithLabel(agentItem, 'Stream all the things');
    }, 'Plan to appear in agent children via streaming');

    const agentItem = getTestAPI().findAgentInTree(agent1Name);
    assertOk(agentItem, `${agent1Name} MUST be in tree`);
    assertOk(
      hasChildWithLabel(requireTreeItem(agentItem, 'agentItem must exist'), 'Stream all the things'),
      'Plan goal MUST appear in agent children via streaming',
    );
  });

  // =========================================================================
  // MESSAGES - streamed to VSIX tree
  // =========================================================================

  test('STREAM: Send message via direct HTTP → message APPEARS in messages tree', async () => {
    await directToolCall(BASE_URL, directSession, 'message', {
      action: 'send',
      agent_key: agent1Key,
      agent_name: agent1Name,
      content: 'Streamed message proof',
      to_agent: agent2Name,
    });

    await waitForMessageInTree(getTestAPI(), 'Streamed message');

    const msgItem = getTestAPI().findMessageInTree('Streamed message');
    assertOk(msgItem, 'Message MUST appear in messages tree via streaming');

    const msgLabel = getLabel(requireTreeItem(msgItem, 'msgItem must exist'));
    assertOk(msgLabel.includes(agent1Name), `Message label should contain sender, got: ${msgLabel}`);
  });

  test('STREAM: Broadcast message via direct HTTP → broadcast APPEARS in tree', async () => {
    await directToolCall(BASE_URL, directSession, 'message', {
      action: 'send',
      agent_key: agent2Key,
      agent_name: agent2Name,
      content: 'STREAM BROADCAST to all',
      to_agent: '*',
    });

    await waitForMessageInTree(getTestAPI(), 'STREAM BROADCAST');

    const broadcastMsg = getTestAPI().findMessageInTree('STREAM BROADCAST');
    assertOk(broadcastMsg, 'Broadcast MUST appear in tree via streaming');

    const label = getLabel(broadcastMsg!);
    assertOk(label.includes('all'), `Broadcast should show "all" for recipient, got: ${label}`);
  });

  // =========================================================================
  // CONNECT DOES NOT RESET SERVER
  // =========================================================================

  test('STREAM: Reconnect still receives streamed events', async () => {
    const api = getTestAPI();

    // Disconnect and reconnect
    await safeDisconnect();
    assertEqual(api.isConnected(), false, 'Should be disconnected');

    await api.connect();
    await waitForConnection();

    // Re-init direct session after reconnect
    directSession = await initDirectMcpSession(BASE_URL, MCP_ENDPOINT, DIRECT_CLIENT_NAME);

    // Register a new agent via direct HTTP after reconnect
    const reconnectAgent = `stream-reconnect-${Date.now()}`;
    const result = await directToolCall(BASE_URL, directSession, 'register', { name: reconnectAgent });
    const reconnectKey = extractKeyFromResult(result);
    assertOk(reconnectKey.length > 0, 'Should get key after reconnect');

    // Agent MUST appear via streaming after reconnect
    await waitForAgentInTree(api, reconnectAgent);
    assertOk(api.findAgentInTree(reconnectAgent), `${reconnectAgent} MUST appear via streaming after reconnect`);
  });

  // =========================================================================
  // FULL ROUND TRIP - all operations streamed, verified at tree level
  // =========================================================================

  test('STREAM: Full round trip - register, lock, plan, message all stream to tree', async () => {
    // Re-init direct session after reconnect
    directSession = await initDirectMcpSession(BASE_URL, MCP_ENDPOINT, DIRECT_CLIENT_NAME);

    const roundTripAgent = `stream-roundtrip-${testId}`;
    const rtResult = await directToolCall(BASE_URL, directSession, 'register', { name: roundTripAgent });
    const rtKey = extractKeyFromResult(rtResult);

    // Wait for agent to appear via stream
    await waitForAgentInTree(getTestAPI(), roundTripAgent);

    // Acquire lock via stream
    await acquireLockDirect(rtKey, roundTripAgent, '/stream/roundtrip.ts', 'Full round trip');

    // Update plan via stream
    await directToolCall(BASE_URL, directSession, 'plan', {
      action: 'update',
      agent_key: rtKey,
      agent_name: roundTripAgent,
      current_task: 'Round trip task',
      goal: 'Round trip goal',
    });
    await waitForCondition(() => {
      const item = getTestAPI().findAgentInTree(roundTripAgent);
      if (!item) { return false; }
      return hasChildWithLabel(item, 'Round trip goal');
    }, 'Round trip plan in tree');

    // Send message via stream
    await directToolCall(BASE_URL, directSession, 'message', {
      action: 'send',
      agent_key: rtKey,
      agent_name: roundTripAgent,
      content: 'Round trip message proof',
      to_agent: '*',
    });
    await waitForMessageInTree(getTestAPI(), 'Round trip message');

    // ALL operations verified at tree/DOM level via streaming
    dumpTree('FINAL AGENTS', getTestAPI().getAgentsTreeSnapshot());
    dumpTree('FINAL LOCKS', getTestAPI().getLocksTreeSnapshot());
    dumpTree('FINAL MESSAGES', getTestAPI().getMessagesTreeSnapshot());

    assertOk(getTestAPI().findAgentInTree(roundTripAgent), 'Round trip agent in tree');
    assertOk(getTestAPI().findLockInTree('/stream/roundtrip.ts'), 'Round trip lock in tree');
    assertOk(getTestAPI().findMessageInTree('Round trip message'), 'Round trip message in tree');

    const agentItem = getTestAPI().findAgentInTree(roundTripAgent);
    assertOk(agentItem, 'Round trip agent MUST exist');
    assertOk(hasChildWithLabel(requireTreeItem(agentItem, 'agentItem must exist'), 'Round trip goal'), 'Round trip plan in agent children');
    assertOk(hasChildWithLabel(requireTreeItem(agentItem, 'agentItem must exist'), '/stream/roundtrip.ts'), 'Round trip lock in agent children');
  });
});
