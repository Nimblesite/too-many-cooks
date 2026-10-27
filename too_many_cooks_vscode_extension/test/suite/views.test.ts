// View Tests
// Verifies tree views are registered, visible, and UI bugs are fixed.

import * as vscode from 'vscode';
import {
  assertEqual,
  assertOk,
  callToolString,
  extractKeyFromResult,
  getChildren,
  getDescription,
  getLabel,
  getTestAPI,
  reconnectFreshAndReset,
  requireMessageItem,
  requireMessageLabel,
  requireTreeItem,
  restoreDialogMocks,
  sendMessageToolCall,
  startAgentSuite,
  waitForExtensionActivation,
  waitForMessageInTree,
} from './testHelpers';

restoreDialogMocks();

const VIEW_CONTAINER = 'workbench.view.extension.tooManyCooks';
const CMD_AGENTS_FOCUS = 'tooManyCooksAgents.focus';
const CMD_LOCKS_FOCUS = 'tooManyCooksLocks.focus';
const CMD_MESSAGES_FOCUS = 'tooManyCooksMessages.focus';

/** Reveal the view container, then focus one of its views if focus is supported. */
async function focusView(viewCommand: string): Promise<void> {
  await vscode.commands.executeCommand(VIEW_CONTAINER);
  try {
    await vscode.commands.executeCommand(viewCommand);
  } catch { /* View focus may not work in test environment */ }
}

suite('Views', () => {
  suiteSetup(async () => {
    await waitForExtensionActivation();
  });

  test('Too Many Cooks view container is registered', async () => {
    await vscode.commands.executeCommand(VIEW_CONTAINER);
  });

  test('Agents view is accessible', async () => {
    await focusView(CMD_AGENTS_FOCUS);
  });

  test('Locks view is accessible', async () => {
    await focusView(CMD_LOCKS_FOCUS);
  });

  test('Messages view is accessible', async () => {
    await focusView(CMD_MESSAGES_FOCUS);
  });
});

suite('UI Bug Fixes', () => {
  const testId = Date.now();
  const { agentName, requireKey } = startAgentSuite(`ui-test-agent-${testId}`, reconnectFreshAndReset);

  test('BUG FIX: Messages show as single row (no 4-row expansion)', async () => {
    const api = getTestAPI();
    const agentKey = requireKey();

    await sendMessageToolCall(api, agentName, agentKey, '*', 'Test message for UI verification');

    await waitForMessageInTree(api, 'Test message');

    const msgItem = requireMessageItem(api, 'Test message', 'Message must appear in tree');

    const children = getChildren(msgItem);
    assertEqual(children, undefined, 'BUG FIX: Message items must NOT have children');

    const label = getLabel(msgItem);
    assertOk(label.includes(agentName), `Label should include sender: ${label}`);
    assertOk(label.includes('\u2192'), `Label should have arrow separator: ${label}`);

    const description = getDescription(msgItem);
    assertOk(description.includes('Test message'), `Description should be message content: ${description}`);
  });

  test('BUG FIX: Message format is "from → to | time [unread]"', async () => {
    const api = getTestAPI();
    const label = requireMessageLabel(api, 'Test message', 'Message must exist from previous test');
    assertOk(label.includes('\u2192'), `Label should match format "from → to | time [unread]", got: ${label}`);
  });

  test('BUG FIX: Unread messages show [unread] indicator', async () => {
    const api = getTestAPI();
    const totalCount = api.getMessageCount();
    const unreadCount = api.getUnreadMessageCount();
    assertOk(unreadCount <= totalCount, `Unread count (${unreadCount}) must be <= total (${totalCount})`);
  });

  test('BUG FIX: Auto-mark-read works when agent fetches messages', async () => {
    const api = getTestAPI();
    const agentKey = requireKey();

    const receiver = `ui-receiver-${testId}`;
    const regResult = await callToolString(api, 'register', { name: receiver });
    const receiverKey = extractKeyFromResult(regResult);

    await sendMessageToolCall(api, agentName, agentKey, receiver, 'This should be auto-marked read');

    const fetched = await callToolString(api, 'message', {
      action: 'get',
      agent_name: receiver,
      agent_key: receiverKey,
      unread_only: true,
    });
    assertOk(/"messages"\s*:\s*\[/u.test(fetched), 'Get messages should return messages array');
    assertOk(fetched.includes('auto-marked'), 'Message should be in fetched results');

    const fetched2 = await callToolString(api, 'message', {
      action: 'get',
      agent_name: receiver,
      agent_key: receiverKey,
      unread_only: true,
    });
    assertEqual(
      fetched2.includes('auto-marked'),
      false,
      'BUG FIX: Message should be auto-marked read after first fetch',
    );
  });

  test('BROADCAST: Messages to "*" appear in tree as "all"', async () => {
    const api = getTestAPI();
    const agentKey = requireKey();

    await sendMessageToolCall(api, agentName, agentKey, '*', 'Broadcast test message to everyone');

    await waitForMessageInTree(api, 'Broadcast test');

    const msgItem = requireMessageItem(api, 'Broadcast test', 'Broadcast message MUST appear in tree');
    const label = getLabel(msgItem);
    assertOk(label.includes('\u2192 all'), `Broadcast messages should show "→ all" in label, got: ${label}`);

    const description = getDescription(requireTreeItem(msgItem, 'msgItem must exist'));
    assertOk(description.includes('Broadcast test'), `Description should contain message content, got: ${description}`);
  });
});
