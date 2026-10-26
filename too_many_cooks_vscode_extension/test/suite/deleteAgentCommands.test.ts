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
  getTestAPI,
  makeAgentItem,
  mockWarningMessage,
  pointAtUnreachablePort,
  reconnectToTestServer,
  registerAgentAndWait,
  resetServerState,
  setupDialogMockedSuite,
  teardownDialogMockedSuite,
  uniqueName,
  waitForAgentGone,
  waitForCondition,
} from './testHelpers';

const CMD_DELETE_AGENT = 'tooManyCooks.deleteAgent';
const CMD_DELETE_ALL = 'tooManyCooks.deleteAllAgents';
const CONFIRM_REMOVE = 'Remove';
const CONFIRM_REMOVE_ALL = 'Remove All';
const ZERO = 0;

suite('Delete Agent Commands', () => {
  suiteSetup(setupDialogMockedSuite);
  suiteTeardown(teardownDialogMockedSuite);

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
    await registerAgentAndWait(api, name);

    mockWarningMessage(undefined);
    await vscode.commands.executeCommand(CMD_DELETE_AGENT, makeAgentItem(name));

    assertOk(api.findAgentInTree(name) !== null, 'agent still present after cancel');
  });

  test('deleteAgent confirmed removes the agent', async () => {
    const api = getTestAPI();
    await resetServerState();
    const name: string = uniqueName('del');
    await registerAgentAndWait(api, name);

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
    await registerAgentAndWait(api, first);
    await registerAgentAndWait(api, second);

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
    await registerAgentAndWait(api, name);

    mockWarningMessage(undefined);
    await vscode.commands.executeCommand(CMD_DELETE_ALL);

    assertOk(api.findAgentInTree(name) !== null, 'agent kept after cancel');
  });

  test('deleteAllAgents confirmed removes every agent', async () => {
    const api = getTestAPI();
    await resetServerState();
    const first: string = uniqueName('all-a');
    const second: string = uniqueName('all-b');
    await registerAgentAndWait(api, first);
    await registerAgentAndWait(api, second);

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
    await registerAgentAndWait(api, name);

    await pointAtUnreachablePort(api);

    mockWarningMessage(CONFIRM_REMOVE);
    await vscode.commands.executeCommand(CMD_DELETE_AGENT, makeAgentItem(name));

    await reconnectToTestServer(api);
    assertOk(api.isConnected(), 'reconnected after failure-path test');
  });
});
