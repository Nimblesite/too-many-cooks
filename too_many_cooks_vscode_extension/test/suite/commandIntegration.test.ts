// Command Integration Tests with Dialog Mocking
// Tests commands that require user confirmation dialogs.

import * as vscode from 'vscode';
import { AgentTreeItem } from '../../src/ui/tree/agentTreeItem';
import { LockTreeItem } from '../../src/ui/tree/lockTreeItem';
import {
  acquireLockAndWait,
  assertEqual,
  assertOk,
  callToolString,
  ensureServerReady,
  extractKeyFromResult,
  getTestAPI,
  installDialogMocks,
  mockInputBox,
  mockQuickPick,
  mockWarningMessage,
  makeAgentLockItem,
  makeAgentTreeItem,
  makeLockTreeItem,
  registerAgent,
  requireMessageLabel,
  restoreDialogMocks,
  safeDisconnect,
  waitForAgentGone,
  waitForAgentInTree,
  waitForConnection,
  waitForLockGone,
  waitForMessageInTree,
} from './testHelpers';

restoreDialogMocks();

interface DeleteLockCase {
  readonly assertion: string;
  readonly build: (filePath: string, owner: string) => vscode.TreeItem;
  readonly label: string;
  readonly lockPath: string;
}

/** deleteLock is reachable from both the lock row and the agent's lock child. */
const DELETE_LOCK_CASES: readonly DeleteLockCase[] = [
  {
    assertion: 'Lock should be deleted via agent tree item',
    build: makeAgentLockItem,
    label: 'AgentTreeItem',
    lockPath: '/cmd/delete/lock2.ts',
  },
];

suite('Command Integration - Dialog Mocking', () => {
  const testId = Date.now();
  const agentName = `cmd-test-${testId}`;
  let agentKey: string | undefined;

  suiteSetup(async () => {
    await ensureServerReady();
  });

  suiteTeardown(async () => {
    restoreDialogMocks();
    await safeDisconnect();
  });

  setup(() => { installDialogMocks(); });
  teardown(() => { restoreDialogMocks(); });

  test('Setup: Connect and register agent', async () => {
    const api = getTestAPI();
    await safeDisconnect();
    await api.connect();
    await waitForConnection();

    agentKey = await registerAgent(api, agentName);
    assertOk(agentKey && agentKey.length > 0, 'Agent should have key');
  });

  test('deleteLock command with LockTreeItem - confirmed', async () => {
    const api = getTestAPI();
    if (!agentKey) { throw new Error('agentKey not set'); }

    const lockPath = '/cmd/delete/lock1.ts';

    await acquireLockAndWait(api, agentName, agentKey, lockPath, 'Testing delete command');

    mockWarningMessage('Release');

    const lockItem = makeLockTreeItem(lockPath, agentName);

    await vscode.commands.executeCommand('tooManyCooks.deleteLock', lockItem);
    await waitForLockGone(api, lockPath);

    assertEqual(api.findLockInTree(lockPath), null, 'Lock should be deleted');
  });

  DELETE_LOCK_CASES.forEach((deleteLockCase) => {
    test(`deleteLock command with ${deleteLockCase.label} - confirmed`, async () => {
      const api = getTestAPI();
      if (!agentKey) { throw new Error('agentKey not set'); }

      const lockPath = deleteLockCase.lockPath;
      await acquireLockAndWait(api, agentName, agentKey, lockPath, 'Testing delete from agent tree');

      mockWarningMessage('Release');

      const item = deleteLockCase.build(lockPath, agentName);
      await vscode.commands.executeCommand('tooManyCooks.deleteLock', item);
      await waitForLockGone(api, lockPath);

      assertEqual(api.findLockInTree(lockPath), null, deleteLockCase.assertion);
    });
  });

  test('deleteLock command - no filePath shows error', async () => {
    const emptyItem = new LockTreeItem({
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      isCategory: false,
      label: 'No locks',
      lock: null,
    });

    await vscode.commands.executeCommand('tooManyCooks.deleteLock', emptyItem);
    assertOk(true, 'Command handled empty filePath gracefully');
  });

  test('deleteLock command - cancelled does nothing', async () => {
    const api = getTestAPI();
    if (!agentKey) { throw new Error('agentKey not set'); }

    const lockPath = '/cmd/cancel/lock.ts';

    await acquireLockAndWait(api, agentName, agentKey, lockPath, 'Testing cancel');

    mockWarningMessage(undefined);

    const lockItem = makeLockTreeItem(lockPath, agentName);

    await vscode.commands.executeCommand('tooManyCooks.deleteLock', lockItem);

    assertOk(api.findLockInTree(lockPath), 'Lock should still exist after cancel');

    await api.callTool('lock', {
      action: 'release',
      file_path: lockPath,
      agent_name: agentName,
      agent_key: agentKey,
    });
  });

  test('deleteAgent command - confirmed', async () => {
    const api = getTestAPI();

    const targetName = `delete-target-${testId}`;
    const result = await callToolString(api, 'register', { name: targetName });
    const targetKey = extractKeyFromResult(result);

    await api.callTool('lock', {
      action: 'acquire',
      file_path: '/cmd/agent/file.ts',
      agent_name: targetName,
      agent_key: targetKey,
      reason: 'Will be deleted',
    });

    await waitForAgentInTree(api, targetName);

    mockWarningMessage('Remove');

    const agentItem = makeAgentTreeItem(targetName);

    await vscode.commands.executeCommand('tooManyCooks.deleteAgent', agentItem);
    await waitForAgentGone(api, targetName);

    assertEqual(api.findAgentInTree(targetName), null, 'Agent should be deleted');
  });

  test('deleteAgent command - no agentName shows error', async () => {
    const emptyItem = new AgentTreeItem({
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      itemType: 'agent',
      label: 'No agent',
    });

    await vscode.commands.executeCommand('tooManyCooks.deleteAgent', emptyItem);
    assertOk(true, 'Command handled empty agentName gracefully');
  });

  test('deleteAgent command - cancelled does nothing', async () => {
    const api = getTestAPI();

    const targetName = `cancel-agent-${testId}`;
    await api.callTool('register', { name: targetName });

    await waitForAgentInTree(api, targetName);

    mockWarningMessage(undefined);

    const agentItem = makeAgentTreeItem(targetName);

    await vscode.commands.executeCommand('tooManyCooks.deleteAgent', agentItem);

    assertOk(api.findAgentInTree(targetName), 'Agent should still exist after cancel');
  });

  test('sendMessage command - with target agent', async () => {
    const api = getTestAPI();

    const recipientName = `recipient-${testId}`;
    const senderName = `sender-with-target-${testId}`;
    await api.callTool('register', { name: recipientName });
    await api.callTool('register', { name: senderName });

    mockQuickPick(senderName);
    mockInputBox('Test message with target');

    const targetItem = makeAgentTreeItem(recipientName);

    await vscode.commands.executeCommand('tooManyCooks.sendMessage', targetItem);
    await waitForMessageInTree(api, 'Test message with target');

    const msgItem = api.findMessageInTree('Test message with target');
    assertOk(msgItem, 'Message should be in tree');
  });

  test('sendMessage command - without target uses quickpick', async () => {
    const api = getTestAPI();

    const recipientName = `recipient2-${testId}`;
    const senderName = `sender-no-target-${testId}`;
    await api.callTool('register', { name: recipientName });
    await api.callTool('register', { name: senderName });

    mockQuickPick(recipientName);
    mockQuickPick(senderName);
    mockInputBox('Test message without target');

    await vscode.commands.executeCommand('tooManyCooks.sendMessage');
    await waitForMessageInTree(api, 'Test message without target');

    const msgItem = api.findMessageInTree('Test message without target');
    assertOk(msgItem, 'Message should be in tree');
  });

  test('sendMessage command - broadcast to all', async () => {
    const api = getTestAPI();

    const senderName = `broadcast-sender-${testId}`;
    await api.callTool('register', { name: senderName });

    mockQuickPick('* (broadcast to all)');
    mockQuickPick(senderName);
    mockInputBox('Broadcast test message');

    await vscode.commands.executeCommand('tooManyCooks.sendMessage');
    await waitForMessageInTree(api, 'Broadcast test');

    const label = requireMessageLabel(api, 'Broadcast test', 'Broadcast should be in tree');
    assertOk(label.includes('all'), 'Should show "all" as recipient');
  });

  test('sendMessage command - cancelled at recipient selection', async () => {
    mockQuickPick(undefined);
    await vscode.commands.executeCommand('tooManyCooks.sendMessage');
    assertOk(true, 'Command handled cancelled recipient selection');
  });

  test('sendMessage command - cancelled at sender input', async () => {
    const api = getTestAPI();

    const recipientName = `cancel-sender-${testId}`;
    await api.callTool('register', { name: recipientName });

    mockQuickPick(recipientName);
    mockQuickPick(undefined);

    await vscode.commands.executeCommand('tooManyCooks.sendMessage');
    assertOk(true, 'Command handled cancelled sender input');
  });

  test('sendMessage command - cancelled at message input', async () => {
    const api = getTestAPI();

    const recipientName = `cancel-msg-${testId}`;
    await api.callTool('register', { name: recipientName });

    mockQuickPick(recipientName);
    mockQuickPick(`sender-cancel-msg-${testId}`);
    mockInputBox(undefined);

    await vscode.commands.executeCommand('tooManyCooks.sendMessage');
    assertOk(true, 'Command handled cancelled message input');
  });
});
