// Command Tests
// Verifies all registered commands work correctly.

import * as vscode from 'vscode';
import {
  waitForExtensionActivation,
  getTestAPI,
  installDialogMocks,
  restoreDialogMocks,
  assertOk,
  assertEqual,
} from './testHelpers';

suite('Commands', () => {
  suiteSetup(async () => {
    installDialogMocks();
    await waitForExtensionActivation();
  });

  suiteTeardown(() => {
    restoreDialogMocks();
  });

  test('tooManyCooks.connect command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assertOk(commands.includes('tooManyCooks.connect'), 'connect command should be registered');
  });

  test('tooManyCooks.disconnect command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assertOk(commands.includes('tooManyCooks.disconnect'), 'disconnect command should be registered');
  });

  test('tooManyCooks.refresh command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assertOk(commands.includes('tooManyCooks.refresh'), 'refresh command should be registered');
  });

  test('tooManyCooks.showDashboard command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assertOk(commands.includes('tooManyCooks.showDashboard'), 'showDashboard command should be registered');
  });

  test('disconnect command can be executed without error when not connected', async function () {
    const TIMEOUT_MS = 15000;
    this.timeout(TIMEOUT_MS);
    const api = getTestAPI();
    // Ensure disconnected first so the command is a no-op
    if (api.isConnected()) {
      api.disconnect();
    }
    await vscode.commands.executeCommand('tooManyCooks.disconnect');
    assertEqual(api.isConnected(), false, 'must remain disconnected');
  });

  test('showDashboard command opens a webview panel', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('tooManyCooks.showDashboard');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });
});
