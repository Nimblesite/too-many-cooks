// Extension command failure-path coverage.
//
// The connect and refresh commands swallow errors and surface them via the
// dialog service. Pointing the store manager at an unreachable port makes
// storeManager.connect/refreshStatus throw, exercising both catch blocks.

import * as vscode from 'vscode';

import {
  assertOk,
  assertShownErrorMessage,
  clearShownDialogMessages,
  getTestAPI,
  mockWarningMessage,
  pointAtUnreachablePort,
  reconnectToTestServer,
  setupDialogMockedSuite,
  teardownDialogMockedSuite,
} from './testHelpers';

const CMD_CONNECT = 'tooManyCooks.connect';
const CMD_REFRESH = 'tooManyCooks.refresh';
const CMD_DELETE_LOCK = 'tooManyCooks.deleteLock';
const CONFIRM_RELEASE = 'Release';
const FAKE_LOCK_PATH = '/tmp/failure-path-lock.ts';
const CONNECT_ERROR_PREFIX = 'Failed to connect:';
const REFRESH_ERROR_PREFIX = 'Failed to refresh:';
const RELEASE_ERROR_PREFIX = 'Failed to release lock:';

suite('Extension Command Failure Paths', () => {
  suiteSetup(setupDialogMockedSuite);
  suiteTeardown(teardownDialogMockedSuite);

  test('connect and refresh commands surface server failures', async () => {
    const api = getTestAPI();
    await pointAtUnreachablePort(api);
    clearShownDialogMessages();

    await vscode.commands.executeCommand(CMD_CONNECT);
    await vscode.commands.executeCommand(CMD_REFRESH);

    assertShownErrorMessage(CONNECT_ERROR_PREFIX);
    assertShownErrorMessage(REFRESH_ERROR_PREFIX);

    await reconnectToTestServer(api);
    assertOk(api.isConnected(), 'reconnected after failure-path test');
  });

  test('deleteLock command surfaces a release failure', async () => {
    const api = getTestAPI();
    await pointAtUnreachablePort(api);
    clearShownDialogMessages();

    mockWarningMessage(CONFIRM_RELEASE);
    await vscode.commands.executeCommand(CMD_DELETE_LOCK, { filePath: FAKE_LOCK_PATH });

    assertShownErrorMessage(RELEASE_ERROR_PREFIX);

    await reconnectToTestServer(api);
    assertOk(api.isConnected(), 'reconnected after deleteLock failure test');
  });
});
