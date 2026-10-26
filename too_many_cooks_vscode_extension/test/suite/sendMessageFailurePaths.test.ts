// Send-message command failure and edge-path coverage.
//
// Exercises the three remaining sendMessageCommand branches not covered by the
// happy-path commandIntegration suite: the long-content truncation branch, the
// delivery-failure catch, and the not-connected early return.

import * as vscode from 'vscode';

import {
  assertOk,
  assertShownErrorMessage,
  assertShownInformationMessage,
  clearShownDialogMessages,
  ensureServerReady,
  getShownInformationMessages,
  getTestAPI,
  installDialogMocks,
  mockInputBox,
  mockQuickPick,
  pointAtUnreachablePort,
  reconnectToTestServer,
  registerAgent,
  resetServerState,
  restoreDialogMocks,
  safeDisconnect,
  waitForAgentInTree,
  waitForMessageInTree,
} from './testHelpers';

const CMD_SEND_MESSAGE = 'tooManyCooks.sendMessage';
const LONG_CONTENT_LENGTH = 100;
const REPEAT_CHAR = 'x';
const PREVIEW_LENGTH = 50;
const TRUNCATION_SUFFIX = '...';
const TRUNCATED_PREVIEW: string = REPEAT_CHAR.repeat(PREVIEW_LENGTH) + TRUNCATION_SUFFIX;
const MESSAGE_BODY = 'message body';
const SENT_INFO_PREFIX = 'Message sent';
const SEND_FAILURE_PREFIX = 'Failed to send message to ';
const NOT_CONNECTED_MESSAGE = 'Not connected to server';
const LONG_CONTENT_FRAGMENT = 'xxx';

function makeAgentItem(agentName: string): unknown {
  return { agentName };
}

function uniqueName(prefix: string): string {
  return `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * 100000))}`;
}

suite('Send Message Failure Paths', () => {
  suiteSetup(async () => {
    await ensureServerReady();
    installDialogMocks();
  });

  suiteTeardown(async () => {
    restoreDialogMocks();
    await safeDisconnect();
  });

  test('long message content takes the truncation branch', async () => {
    const api = getTestAPI();
    await resetServerState();
    const sender: string = uniqueName('long-sender');
    const recipient: string = uniqueName('long-recipient');
    await registerAgent(api, sender);
    await registerAgent(api, recipient);
    await waitForAgentInTree(api, recipient);
    clearShownDialogMessages();

    const longContent: string = REPEAT_CHAR.repeat(LONG_CONTENT_LENGTH);
    mockQuickPick(recipient);
    mockQuickPick(sender);
    mockInputBox(longContent);
    await vscode.commands.executeCommand(CMD_SEND_MESSAGE);

    await waitForMessageInTree(api, LONG_CONTENT_FRAGMENT);
    assertOk(
      api.getMessages().some((m) => m.content === longContent),
      'long message delivered in full',
    );
    assertShownInformationMessage(TRUNCATED_PREVIEW);
  });

  test('sendMessage surfaces a delivery failure', async () => {
    const api = getTestAPI();
    await resetServerState();
    const name: string = uniqueName('fail-send');
    await registerAgent(api, name);
    await waitForAgentInTree(api, name);

    await pointAtUnreachablePort(api);
    clearShownDialogMessages();

    mockQuickPick(name);
    mockInputBox(MESSAGE_BODY);
    await vscode.commands.executeCommand(CMD_SEND_MESSAGE, makeAgentItem(name));

    assertShownErrorMessage(`${SEND_FAILURE_PREFIX}${name}:`);
    assertOk(
      !getShownInformationMessages().some((m) => m.includes(SENT_INFO_PREFIX)),
      'delivery failure shows no success message',
    );

    await reconnectToTestServer(api);
    assertOk(api.isConnected(), 'reconnected after delivery-failure test');
  });

  test('sendMessage reports not-connected when the server is unreachable', async () => {
    const api = getTestAPI();
    await pointAtUnreachablePort(api);
    clearShownDialogMessages();

    await vscode.commands.executeCommand(CMD_SEND_MESSAGE);

    assertShownErrorMessage(NOT_CONNECTED_MESSAGE);

    await reconnectToTestServer(api);
    assertOk(api.isConnected(), 'reconnected after not-connected test');
  });
});
