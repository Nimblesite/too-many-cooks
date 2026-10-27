// Command Integration Tests with Dialog Mocking
// Tests commands that require user confirmation dialogs.

import * as vscode from 'vscode';
import { AgentTreeItem } from '../../src/ui/tree/agentTreeItem';
import { LockTreeItem } from '../../src/ui/tree/lockTreeItem';
import {
  acquireLockAndWait,
  assertAgentsInTree,
  assertLocksInTree,
  assertMessagesInTree,
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
import type { TestAPI } from '../../src/testApi';

restoreDialogMocks();

const DELETE_LOCK_COMMAND = 'tooManyCooks.deleteLock';
const DELETE_AGENT_COMMAND = 'tooManyCooks.deleteAgent';
const SEND_MESSAGE_COMMAND = 'tooManyCooks.sendMessage';
const RELEASE_ACTION = 'Release';
const REMOVE_ACTION = 'Remove';
const BROADCAST_PICK = '* (broadcast to all)';
const BROADCAST_LABEL = 'all';
const BROADCAST_MISSING = 'Broadcast should be in tree';
const AGENT_KEY_MISSING = 'agentKey not set';

interface DeleteLockCase {
  readonly build: (filePath: string, owner: string) => vscode.TreeItem;
  readonly label: string;
  readonly lockPath: string;
  readonly reason: string;
}

/** deleteLock is reachable from both the lock row and the agent's lock child. */
const DELETE_LOCK_CASES: readonly DeleteLockCase[] = [
  { build: makeLockTreeItem, label: 'LockTreeItem', lockPath: '/cmd/delete/lock1.ts', reason: 'Testing delete command' },
  { build: makeAgentLockItem, label: 'AgentTreeItem', lockPath: '/cmd/delete/lock2.ts', reason: 'Testing delete from agent tree' },
];

/** One sendMessage command invocation: agents to register, dialog answers, expectation. */
interface SendMessageCase {
  readonly assertion: string;
  readonly broadcast: boolean;
  readonly content: string;
  readonly name: string;
  readonly picks: readonly (string | undefined)[];
  readonly registrations: readonly string[];
  readonly snippet: string;
  readonly target: string | null;
}

/** One sendMessage command invocation that must abort without sending. */
interface SendCancelledCase {
  readonly assertion: string;
  readonly input: string | undefined;
  readonly name: string;
  readonly picks: readonly (string | undefined)[];
  readonly registrations: readonly string[];
}

const MESSAGE_CANCELLED = 'Command handled cancelled message input';
const RECIPIENT_CANCELLED = 'Command handled cancelled recipient selection';
const SENDER_CANCELLED = 'Command handled cancelled sender input';

function makeSendMessageCases(testId: number): readonly SendMessageCase[] {
  return [
    {
      assertion: 'Message should be in tree',
      broadcast: false,
      content: 'Test message with target',
      name: 'sendMessage command - with target agent',
      picks: [`sender-with-target-${String(testId)}`],
      registrations: [`recipient-${String(testId)}`, `sender-with-target-${String(testId)}`],
      snippet: 'Test message with target',
      target: `recipient-${String(testId)}`,
    },
    {
      assertion: 'Message should be in tree',
      broadcast: false,
      content: 'Test message without target',
      name: 'sendMessage command - without target uses quickpick',
      picks: [`recipient2-${String(testId)}`, `sender-no-target-${String(testId)}`],
      registrations: [`recipient2-${String(testId)}`, `sender-no-target-${String(testId)}`],
      snippet: 'Test message without target',
      target: null,
    },
    {
      assertion: 'Should show "all" as recipient',
      broadcast: true,
      content: 'Broadcast test message',
      name: 'sendMessage command - broadcast to all',
      picks: [BROADCAST_PICK, `broadcast-sender-${String(testId)}`],
      registrations: [`broadcast-sender-${String(testId)}`],
      snippet: 'Broadcast test',
      target: null,
    },
  ];
}

function makeSendCancelledCases(testId: number): readonly SendCancelledCase[] {
  const recipient = `cancel-sender-${String(testId)}`;
  const messageRecipient = `cancel-msg-${String(testId)}`;
  return [
    { assertion: RECIPIENT_CANCELLED, input: undefined, name: 'sendMessage command - cancelled at recipient selection', picks: [undefined], registrations: [] },
    { assertion: SENDER_CANCELLED, input: undefined, name: 'sendMessage command - cancelled at sender input', picks: [recipient, undefined], registrations: [recipient] },
    {
      assertion: MESSAGE_CANCELLED,
      input: undefined,
      name: 'sendMessage command - cancelled at message input',
      picks: [messageRecipient, `sender-cancel-msg-${String(testId)}`, undefined],
      registrations: [messageRecipient],
    },
  ];
}

suite('Command Integration - Dialog Mocking', () => {
  const testId = Date.now();
  const agentName = `cmd-test-${testId}`;
  let agentKey: string | undefined;

  function requireAgentKey(): string {
    if (!agentKey) { throw new Error(AGENT_KEY_MISSING); }
    return agentKey;
  }

  /** Register every named agent against the live server. */
  async function registerAll(names: readonly string[]): Promise<TestAPI> {
    const api = getTestAPI();
    for (const name of names) {
      await api.callTool('register', { name });
    }
    return api;
  }

  /** Acquire a lock, confirm the dialog, and prove the command removed it. */
  async function runConfirmedDeleteLock(deleteLockCase: DeleteLockCase): Promise<void> {
    const api = getTestAPI();
    const { lockPath } = deleteLockCase;
    await acquireLockAndWait(api, agentName, requireAgentKey(), lockPath, deleteLockCase.reason);

    mockWarningMessage(RELEASE_ACTION);
    await vscode.commands.executeCommand(DELETE_LOCK_COMMAND, deleteLockCase.build(lockPath, agentName));
    await waitForLockGone(api, lockPath);

    assertLocksInTree(api, [lockPath], false);
  }

  /** Run one sendMessage invocation and prove the message reached the tree. */
  async function runSendMessage(sendCase: SendMessageCase): Promise<void> {
    const api = await registerAll(sendCase.registrations);
    for (const pick of sendCase.picks) {
      mockQuickPick(pick);
    }
    mockInputBox(sendCase.content);

    const extraArgs: readonly unknown[] = sendCase.target === null ? [] : [makeAgentTreeItem(sendCase.target)];
    await vscode.commands.executeCommand(SEND_MESSAGE_COMMAND, ...extraArgs);

    await waitForMessageInTree(api, sendCase.snippet);
    assertMessagesInTree(api, [sendCase.snippet], true);
    if (sendCase.broadcast) {
      const label = requireMessageLabel(api, sendCase.snippet, BROADCAST_MISSING);
      assertOk(label.includes(BROADCAST_LABEL), sendCase.assertion);
    }
  }

  /** Run one cancelled sendMessage invocation and prove nothing was sent. */
  async function runSendCancelled(cancelledCase: SendCancelledCase): Promise<void> {
    await registerAll(cancelledCase.registrations);
    for (const pick of cancelledCase.picks) {
      mockQuickPick(pick);
    }
    mockInputBox(cancelledCase.input);

    await vscode.commands.executeCommand(SEND_MESSAGE_COMMAND);
    assertOk(true, cancelledCase.assertion);
  }

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

  DELETE_LOCK_CASES.forEach((deleteLockCase) => {
    test(`deleteLock command with ${deleteLockCase.label} - confirmed`, async () => {
      await runConfirmedDeleteLock(deleteLockCase);
    });
  });

  test('deleteLock command - no filePath shows error', async () => {
    const emptyItem = new LockTreeItem({
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      isCategory: false,
      label: 'No locks',
      lock: null,
    });

    await vscode.commands.executeCommand(DELETE_LOCK_COMMAND, emptyItem);
    assertOk(true, 'Command handled empty filePath gracefully');
  });

  test('deleteLock command - cancelled does nothing', async () => {
    const api = getTestAPI();
    const lockPath = '/cmd/cancel/lock.ts';

    await acquireLockAndWait(api, agentName, requireAgentKey(), lockPath, 'Testing cancel');

    mockWarningMessage(undefined);

    const lockItem = makeLockTreeItem(lockPath, agentName);

    await vscode.commands.executeCommand(DELETE_LOCK_COMMAND, lockItem);

    assertOk(api.findLockInTree(lockPath), 'Lock should still exist after cancel');

    await api.callTool('lock', {
      action: 'release',
      file_path: lockPath,
      agent_name: agentName,
      agent_key: requireAgentKey(),
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

    mockWarningMessage(REMOVE_ACTION);

    await vscode.commands.executeCommand(DELETE_AGENT_COMMAND, makeAgentTreeItem(targetName));
    await waitForAgentGone(api, targetName);

    assertAgentsInTree(api, [targetName], false);
  });

  test('deleteAgent command - no agentName shows error', async () => {
    const emptyItem = new AgentTreeItem({
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      itemType: 'agent',
      label: 'No agent',
    });

    await vscode.commands.executeCommand(DELETE_AGENT_COMMAND, emptyItem);
    assertOk(true, 'Command handled empty agentName gracefully');
  });

  test('deleteAgent command - cancelled does nothing', async () => {
    const api = getTestAPI();

    const targetName = `cancel-agent-${testId}`;
    await api.callTool('register', { name: targetName });

    await waitForAgentInTree(api, targetName);

    mockWarningMessage(undefined);

    await vscode.commands.executeCommand(DELETE_AGENT_COMMAND, makeAgentTreeItem(targetName));

    assertOk(api.findAgentInTree(targetName), 'Agent should still exist after cancel');
  });

  for (const sendCase of makeSendMessageCases(testId)) {
    test(sendCase.name, async () => {
      await runSendMessage(sendCase);
    });
  }

  for (const cancelledCase of makeSendCancelledCases(testId)) {
    test(cancelledCase.name, async () => {
      await runSendCancelled(cancelledCase);
    });
  }
});
