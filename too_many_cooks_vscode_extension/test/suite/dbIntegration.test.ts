// Database Integration Tests - REAL end-to-end tests.
// These tests PROVE that UI tree views update when database state changes.
// NO MOCKING. NO SKIPPING. FAIL HARD.

import {
  acquireLockToolCall,
  assertEqual,
  assertLocksInTree,
  assertMessageRow,
  assertMessagesInTree,
  assertOk,
  assertPlanChild,
  assertSeededStore,
  callToolString,
  dumpTree,
  ensureAgentRegistered,
  ensureLockHeld,
  ensureMessageSent,
  ensurePlanUpdated,
  ensureServerReady,
  extractKeyFromResult,
  getChildren,
  getDescription,
  getLabel,
  getTestAPI,
  hasChildWithLabel,
  requireTreeItem,
  restoreDialogMocks,
  safeDisconnect,
  sendMessageToolCall,
  updatePlanToolCall,
  waitForAgentInTree,
  waitForCondition,
  waitForConnection,
  waitForLockGone,
  waitForLockInTree,
  waitForMessageInTree,
} from './testHelpers';
import type { TreeItemSnapshot } from '../../src/testApi';

restoreDialogMocks();

suite('DB Integration - UI Verification', () => {
  let agent1Key = '';
  let agent2Key = '';
  const testId = Date.now();
  const agent1Name = `test-agent-${testId}-1`;
  const agent2Name = `test-agent-${testId}-2`;

  suiteSetup(async () => {
    await ensureServerReady();
    await safeDisconnect();
  });

  suiteTeardown(async () => {
    await safeDisconnect();
  });

  test('Connect to database', async () => {
    await safeDisconnect();
    const api = getTestAPI();

    assertOk(!api.isConnected(), 'Should be disconnected');

    await api.connect();
    await waitForConnection();

    assertOk(api.isConnected(), 'Should be connected');
    assertEqual(api.getConnectionStatus(), 'connected');
  });

  test('Empty state shows empty trees', async () => {
    const api = getTestAPI();
    await api.refreshStatus();

    const agentsTree = api.getAgentsTreeSnapshot();
    const locksTree = api.getLocksTreeSnapshot();
    const messagesTree = api.getMessagesTreeSnapshot();

    dumpTree('AGENTS', agentsTree);
    dumpTree('LOCKS', locksTree);
    dumpTree('MESSAGES', messagesTree);

    assertEqual(agentsTree.length, 0, 'Agents tree should be empty');

    const emptyLabels: readonly (readonly [readonly TreeItemSnapshot[], string])[] = [
      [locksTree, 'No locks'],
      [messagesTree, 'No messages'],
    ];
    for (const [tree, label] of emptyLabels) {
      assertOk(tree.some((i: TreeItemSnapshot): boolean => getLabel(i) === label), `Tree should show "${label}"`);
    }
  });

  test('Register agent-1 → label APPEARS in agents tree', async () => {
    const api = getTestAPI();

    const result = await callToolString(api, 'register', { name: agent1Name });
    agent1Key = extractKeyFromResult(result);
    assertOk(agent1Key.length > 0, 'Should return agent key');

    await waitForAgentInTree(api, agent1Name);

    const agentItem = api.findAgentInTree(agent1Name);
    assertOk(agentItem, `${agent1Name} MUST appear in the tree`);
    assertEqual(getLabel(requireTreeItem(agentItem, 'agentItem must exist')), agent1Name, `Label must be exactly "${agent1Name}"`);
  });

  test('Register agent-2 → both agents visible in tree', async () => {
    const api = getTestAPI();

    const result = await callToolString(api, 'register', { name: agent2Name });
    agent2Key = extractKeyFromResult(result);

    await waitForCondition(
      () => api.getAgentsTreeSnapshot().length >= 2,
      '2 agents in tree',
    );

    const tree = api.getAgentsTreeSnapshot();
    dumpTree('AGENTS after second register', tree);

    assertOk(api.findAgentInTree(agent1Name), `${agent1Name} MUST still be in tree`);
    assertOk(api.findAgentInTree(agent2Name), `${agent2Name} MUST be in tree`);
    assertEqual(tree.length, 2, 'Exactly 2 agent items');
  });

  test('Acquire lock on /src/main.ts → file path APPEARS in locks tree', async () => {
    const api = getTestAPI();

    await acquireLockToolCall(api, '/src/main.ts', agent1Name, agent1Key, 'Editing main');

    await waitForLockInTree(api, '/src/main.ts');

    const lockItem = api.findLockInTree('/src/main.ts');
    dumpTree('LOCKS after acquire', api.getLocksTreeSnapshot());

    assertOk(lockItem, '/src/main.ts MUST appear in the tree');
    assertEqual(getLabel(requireTreeItem(lockItem, 'lockItem must exist')), '/src/main.ts', 'Label must be exact file path');

    const desc = getDescription(requireTreeItem(lockItem, 'lockItem must exist'));
    assertOk(desc.startsWith(agent1Name), `Description should start with agent name. desc="${desc}", agent="${agent1Name}"`);
  });

  test('Acquire 2 more locks → all 3 file paths visible', async () => {
    const api = getTestAPI();

    await acquireLockToolCall(api, '/src/utils.ts', agent1Name, agent1Key, 'Utils');

    await acquireLockToolCall(api, '/src/types.ts', agent2Name, agent2Key, 'Types');

    await waitForCondition(
      () => api.getLockTreeItemCount() >= 3,
      '3 locks in tree',
    );

    dumpTree('LOCKS after 3 acquires', api.getLocksTreeSnapshot());

    assertLocksInTree(api, ['/src/main.ts', '/src/utils.ts', '/src/types.ts'], true);
    assertEqual(api.getLockTreeItemCount(), 3, 'Exactly 3 lock items');
  });

  test('Release /src/utils.ts → file path DISAPPEARS from tree', async () => {
    const api = getTestAPI();

    await callToolString(api, 'lock', {
      action: 'release',
      file_path: '/src/utils.ts',
      agent_name: agent1Name,
      agent_key: agent1Key,
    });

    await waitForLockGone(api, '/src/utils.ts');

    dumpTree('LOCKS after release', api.getLocksTreeSnapshot());

    assertLocksInTree(api, ['/src/utils.ts'], false);
    assertLocksInTree(api, ['/src/main.ts', '/src/types.ts'], true);
    assertEqual(api.getLockTreeItemCount(), 2, 'Exactly 2 lock items remain');
  });

  test('Update plan for agent-1 → plan content APPEARS in agent children', async () => {
    const api = getTestAPI();

    await updatePlanToolCall(api, agent1Name, agent1Key, 'Implement feature X', 'Writing tests');

    await waitForCondition(() => {
      const agentItem = api.findAgentInTree(agent1Name);
      if (!agentItem) { return false; }
      return hasChildWithLabel(agentItem, 'Implement feature X');
    }, `${agent1Name} plan to appear in agent children`);

    dumpTree('AGENTS after plan update', api.getAgentsTreeSnapshot());

    assertPlanChild(api, agent1Name, 'Goal: Implement feature X', 'Writing tests');
  });

  test('Send message agent-1 → agent-2 → message APPEARS in tree', async () => {
    const api = getTestAPI();

    await sendMessageToolCall(api, agent1Name, agent1Key, agent2Name, 'Starting work on main.ts');

    await waitForMessageInTree(api, 'Starting work');

    dumpTree('MESSAGES after send', api.getMessagesTreeSnapshot());

    assertMessageRow(api, 'Starting work', [agent1Name, agent2Name], 'Starting work');
  });

  test('Send 2 more messages → all 3 messages visible with correct labels', async () => {
    const api = getTestAPI();

    await sendMessageToolCall(api, agent2Name, agent2Key, agent1Name, 'Acknowledged');

    await sendMessageToolCall(api, agent1Name, agent1Key, agent2Name, 'Done with main.ts');

    await waitForCondition(
      () => api.getMessageTreeItemCount() >= 3,
      '3 messages in tree',
    );

    dumpTree('MESSAGES after 3 sends', api.getMessagesTreeSnapshot());

    assertMessagesInTree(api, ['Starting work', 'Acknowledged', 'Done with main'], true);
    assertEqual(api.getMessageTreeItemCount(), 3, 'Exactly 3 message items');
  });

  test('Broadcast message to * → message APPEARS in tree with "all" label', async () => {
    const api = getTestAPI();

    await sendMessageToolCall(api, agent1Name, agent1Key, '*', 'BROADCAST: Important announcement for all agents');

    await waitForMessageInTree(api, 'BROADCAST');

    dumpTree('MESSAGES after broadcast', api.getMessagesTreeSnapshot());

    assertMessageRow(api, 'BROADCAST', [agent1Name, 'all'], 'BROADCAST');
    assertEqual(api.getMessageTreeItemCount(), 4, 'Should have 4 messages after broadcast');
  });

  test('Agent tree shows locks/messages for each agent', async () => {
    const api = getTestAPI();
    await api.refreshStatus();

    dumpTree('AGENTS with children', api.getAgentsTreeSnapshot());

    const agent1 = api.findAgentInTree(agent1Name);
    assertOk(agent1, `${agent1Name} MUST be in tree`);
    const children = getChildren(agent1!);
    assertOk(children, `${agent1Name} MUST have children showing locks/messages`);

    assertOk(hasChildWithLabel(agent1!, '/src/main.ts'), `${agent1Name} children MUST include /src/main.ts lock`);
    assertOk(hasChildWithLabel(agent1!, 'Implement feature X'), `${agent1Name} children MUST include plan goal`);
    assertOk(hasChildWithLabel(agent1!, 'Messages'), `${agent1Name} children MUST include Messages summary`);
  });

  test('Refresh syncs all state from server', async () => {
    const api = getTestAPI();
    await api.refreshStatus();

    assertSeededStore(api);
    assertOk(api.getAgentsTreeSnapshot().length >= 2, `At least 2 agents in tree`);
    assertOk(api.getLockTreeItemCount() >= 2, `At least 2 locks in tree`);
    assertOk(api.getMessageTreeItemCount() >= 4, `At least 4 messages in tree`);

    const agentItem = api.findAgentInTree(agent1Name);
    assertOk(agentItem && hasChildWithLabel(agentItem, 'Goal:'), 'Agent should have plan child');
  });

  test('Disconnect clears all tree views', async () => {
    await safeDisconnect();
    const api = getTestAPI();

    assertOk(!api.isConnected(), 'Should be disconnected');

    assertEqual(api.getAgents().length, 0, 'Agents should be empty');
    assertEqual(api.getLocks().length, 0, 'Locks should be empty');
    assertEqual(api.getMessages().length, 0, 'Messages should be empty');
    assertEqual(api.getPlans().length, 0, 'Plans should be empty');

    assertEqual(api.getAgentsTreeSnapshot().length, 0, 'Agents tree should be empty');
    assertEqual(api.getLockTreeItemCount(), 0, 'Locks tree should be empty');
    assertEqual(api.getMessageTreeItemCount(), 0, 'Messages tree should be empty');
  });

  test('Reconnect restores all state and tree views', async () => {
    const api = getTestAPI();

    await api.connect();
    await waitForConnection();
    await api.refreshStatus();

    // Re-create whatever the server lost (WAL not checkpointed on server kill)
    agent1Key = await ensureAgentRegistered(api, agent1Name, agent1Key);
    agent2Key = await ensureAgentRegistered(api, agent2Name, agent2Key);

    await ensureLockHeld(api, '/src/main.ts', agent1Name, agent1Key, 'Editing main');
    await ensureLockHeld(api, '/src/types.ts', agent2Name, agent2Key, 'Types');

    await ensurePlanUpdated(api, agent1Name, agent1Key, 'Implement feature X', 'Writing tests');

    await ensureMessageSent(api, agent1Name, agent1Key, agent2Name, 'Starting work', 'Starting work on main.ts');
    await ensureMessageSent(api, agent2Name, agent2Key, agent1Name, 'Acknowledged', 'Acknowledged');
    await ensureMessageSent(api, agent1Name, agent1Key, agent2Name, 'Done with main', 'Done with main.ts');
    await ensureMessageSent(api, agent1Name, agent1Key, '*', 'BROADCAST', 'BROADCAST: Important announcement for all agents');

    await waitForCondition(
      () => api.getAgentCount() >= 2 && api.getLockCount() >= 2,
      'state to be restored/recreated',
    );

    assertSeededStore(api);
  });
});
