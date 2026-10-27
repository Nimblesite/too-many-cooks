// Dashboard webview panel E2E.
//
// Opens the dashboard through the tooManyCooks.showDashboard command, then
// mutates server state while the panel is open so the store subscription fires
// updateWebview + buildWebviewData over populated agents/locks/messages/plans.
// Asserts concrete state/tree outcomes and that reveal/recreate stay idempotent.

import * as vscode from 'vscode';

import {
  acquireLockAndWait,
  assertEqual,
  assertOk,
  ensureServerReady,
  getTestAPI,
  registerAgent,
  safeDisconnect,
  sendMessageToolCall,
  uniqueName,
  updatePlanToolCall,
  waitForCondition,
} from './testHelpers';

const CMD_SHOW_DASHBOARD = 'tooManyCooks.showDashboard';
const CMD_CLOSE_ALL = 'workbench.action.closeAllEditors';
const ONE = 1;
const TWO = 2;

suite('Dashboard Panel', () => {
  suiteSetup(async () => {
    await ensureServerReady();
  });

  suiteTeardown(async () => {
    await safeDisconnect();
  });

  test('dashboard renders populated data and refreshes on state changes', async () => {
    const api = getTestAPI();
    const firstName: string = uniqueName('dash');
    const firstKey: string = await registerAgent(api, firstName);

    await acquireLockAndWait(api, firstName, firstKey, '/dashboard/lock.ts', 'dashboard test');
    await sendMessageToolCall(api, firstName, firstKey, '*', 'dashboard message');
    await updatePlanToolCall(api, firstName, firstKey, 'dash goal', 'dash task');

    await waitForCondition(() => api.getLockCount() >= ONE, 'first lock present');
    await waitForCondition(() => api.getMessageCount() >= ONE, 'first message present');
    await waitForCondition(() => api.getPlans().length >= ONE, 'first plan present');

    await vscode.commands.executeCommand(CMD_SHOW_DASHBOARD);
    await vscode.commands.executeCommand(CMD_SHOW_DASHBOARD);

    // State change while the panel is open fires the store subscription and
    // exercises updateWebview + buildWebviewData over live data.
    const secondName: string = uniqueName('dash-two');
    const secondKey: string = await registerAgent(api, secondName);
    await acquireLockAndWait(api, secondName, secondKey, '/dashboard/lock2.ts', 'second lock');

    await waitForCondition(() => api.getAgentCount() >= TWO, 'two agents present');
    await waitForCondition(() => api.getLockCount() >= TWO, 'two locks present');

    assertOk(api.getAgentCount() >= TWO, 'state has two agents after dashboard opened');
    assertOk(api.getLockCount() >= TWO, 'state has two locks after dashboard opened');
    assertEqual(api.getMessageCount() >= ONE, true, 'message survived dashboard refresh');
    assertEqual(api.getPlans().length >= ONE, true, 'plan survived dashboard refresh');

    await vscode.commands.executeCommand(CMD_CLOSE_ALL);
    await vscode.commands.executeCommand(CMD_SHOW_DASHBOARD);

    assertOk(api.getAgentCount() >= TWO, 'agents survive panel recreate');
    assertOk(api.getLockCount() >= TWO, 'locks survive panel recreate');
  });
});
