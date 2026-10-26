// Delete-agent command E2E.
//
// Drives tooManyCooks.deleteAgent and tooManyCooks.deleteAllAgents through
// vscode.commands.executeCommand with duck-typed tree items, answering the
// confirmation prompts with the dialog mocks. Asserts concrete tree/state
// outcomes for no-selection, cancel, single delete, multi-delete, and delete-all.

import * as vscode from 'vscode';

import {
  assertEqual,
  assertOk,
  ensureServerReady,
  getTestAPI,
  installDialogMocks,
  mockWarningMessage,
  registerAgent,
  resetServerState,
  restoreDialogMocks,
  safeDisconnect,
  TEST_PORT,
  waitForAgentGone,
  waitForAgentInTree,
  waitForCondition,
  waitForConnection,
} from './testHelpers';

const CMD_DELETE_AGENT = 'tooManyCooks.deleteAgent';
const CMD_DELETE_ALL = 'tooManyCooks.deleteAllAgents';
const CONFIRM_REMOVE = 'Remove';
const CONFIRM_REMOVE_ALL = 'Remove All';
const ZERO = 0;

function makeAgentItem(agentName: string): unknown {
  return { agentName };
}

function uniqueName(prefix: string): string {
  return `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 100000))}`;
}

suite('Delete Agent Commands', () => {
  suiteSetup(async () => {
    await ensureServerReady();
    installDialogMocks();
  });

  suiteTeardown(async () => {
    restoreDialogMocks();
    await safeDisconnect();
  });

  test('deleteAgent with no selection deletes nothing', async () => {
    const api = getTestAPI();
    const before: number = api.getAgentCount();

    await vscode.commands.executeCommand(CMD_DELETE_AGENT);

    assertEqual(api.getAgentCount(), before, 'agent count unchanged without selection');
  });

  test('deleteAgent cancelled by user leaves the agent', async () => {
    const api = getTestAPI();
    await resetServerState();
    const name: string = uniqueName('keep');
    await registerAgent(api, name);
    await waitForAgentInTree(api, name);

    mockWarningMessage(undefined);
    await vscode.commands.executeCommand(CMD_DELETE_AGENT, makeAgentItem(name));

    assertOk(api.findAgentInTree(name) !== null, 'agent still present after cancel');
  });

  test('deleteAgent confirmed removes the agent', async () => {
    const api = getTestAPI();
    await resetServerState();
    const name: string = uniqueName('del');
    await registerAgent(api, name);
    await waitForAgentInTree(api, name);

    mockWarningMessage(CONFIRM_REMOVE);
    await vscode.commands.executeCommand(CMD_DELETE_AGENT, makeAgentItem(name));

    await waitForAgentGone(api, name);
    assertEqual(api.findAgentInTree(name), null, 'agent removed from tree');
    assertEqual(api.getAgents().some((a) => a.agentName === name), false, 'agent removed from state');
  });

  test('deleteAgent removes multiple selected agents in one confirmation', async () => {
    const api = getTestAPI();
    await resetServerState();
    const first: string = uniqueName('multi-a');
    const second: string = uniqueName('multi-b');
    await registerAgent(api, first);
    await registerAgent(api, second);
    await waitForAgentInTree(api, first);
    await waitForAgentInTree(api, second);

    mockWarningMessage(CONFIRM_REMOVE);
    const selection: unknown[] = [makeAgentItem(first), makeAgentItem(second)];
    await vscode.commands.executeCommand(CMD_DELETE_AGENT, undefined, selection);

    await waitForAgentGone(api, first);
    await waitForAgentGone(api, second);
    assertEqual(api.findAgentInTree(first), null, 'first selected agent removed');
    assertEqual(api.findAgentInTree(second), null, 'second selected agent removed');
  });

  test('deleteAllAgents with no agents is a no-op', async () => {
    const api = getTestAPI();
    await resetServerState();
    await api.refreshStatus();
    await waitForCondition(() => api.getAgentCount() === ZERO, 'agents to drain after reset');

    await vscode.commands.executeCommand(CMD_DELETE_ALL);

    assertEqual(api.getAgentCount(), ZERO, 'no agents to remove');
  });

  test('deleteAllAgents cancelled by user keeps agents', async () => {
    const api = getTestAPI();
    await resetServerState();
    const name: string = uniqueName('keep-all');
    await registerAgent(api, name);
    await waitForAgentInTree(api, name);

    mockWarningMessage(undefined);
    await vscode.commands.executeCommand(CMD_DELETE_ALL);

    assertOk(api.findAgentInTree(name) !== null, 'agent kept after cancel');
  });

  test('deleteAllAgents confirmed removes every agent', async () => {
    const api = getTestAPI();
    await resetServerState();
    const first: string = uniqueName('all-a');
    const second: string = uniqueName('all-b');
    await registerAgent(api, first);
    await registerAgent(api, second);
    await waitForAgentInTree(api, first);
    await waitForAgentInTree(api, second);

    mockWarningMessage(CONFIRM_REMOVE_ALL);
    await vscode.commands.executeCommand(CMD_DELETE_ALL);

    await waitForCondition(() => api.getAgentCount() === ZERO, 'all agents removed');
    assertEqual(api.findAgentInTree(first), null, 'first agent removed');
    assertEqual(api.findAgentInTree(second), null, 'second agent removed');
  });

  test('deleteAgent surfaces a failure when the server is unreachable', async () => {
    const api = getTestAPI();
    await resetServerState();
    const name: string = uniqueName('fail');
    await registerAgent(api, name);
    await waitForAgentInTree(api, name);

    await api.disconnect();
    const sm = api.getStoreManager();
    sm.setTarget({ mode: 'local', port: 1, transport: 'http-streamable' });

    mockWarningMessage(CONFIRM_REMOVE);
    await vscode.commands.executeCommand(CMD_DELETE_AGENT, makeAgentItem(name));

    sm.setTarget({ mode: 'local', port: Number(TEST_PORT), transport: 'http-streamable' });
    await api.connect();
    await waitForConnection();
    assertOk(api.isConnected(), 'reconnected after failure-path test');
  });
});
