// Dialog service default wrappers E2E.
//
// The VSIX routes its dialogs through DialogService so tests can install mocks.
// This file instead resets to the REAL default service and proves each wrapper
// delegates to a genuine vscode.window dialog (a Thenable that stays open until
// a user answers) rather than returning a canned value. The toInputBoxOptions
// helper is exercised through both the populated and empty options paths.

import {
  assertEqual,
  delay,
  getActiveDialogService,
  installDialogMocks,
  resetToDefaultDialogService,
  waitForExtensionActivation,
} from './testHelpers';

const PENDING_LABEL = 'pending';
const RESOLVED_LABEL = 'resolved';
const DIALOG_PENDING_MS = 250;

async function raceDialog(promise: Thenable<string | undefined>): Promise<string> {
  const resolved = (async (): Promise<string> => {
    await promise;
    return RESOLVED_LABEL;
  })();
  const pending = (async (): Promise<string> => {
    await delay(DIALOG_PENDING_MS);
    return PENDING_LABEL;
  })();
  return await Promise.race([resolved, pending]);
}

suite('Dialog Service Default Wrappers', () => {
  suiteSetup(async () => {
    await waitForExtensionActivation();
    resetToDefaultDialogService();
  });

  suiteTeardown(() => {
    installDialogMocks();
  });

  test('default wrappers delegate to real vscode.window dialogs', async () => {
    const dialogs = getActiveDialogService();

    assertEqual(
      await raceDialog(dialogs.showErrorMessage('error text')),
      PENDING_LABEL,
      'showErrorMessage stays open awaiting user',
    );
    assertEqual(
      await raceDialog(dialogs.showInformationMessage('info text')),
      PENDING_LABEL,
      'showInformationMessage stays open awaiting user',
    );
    assertEqual(
      await raceDialog(dialogs.showWarningMessage('warn text', { modal: false }, 'OK')),
      PENDING_LABEL,
      'showWarningMessage stays open awaiting user',
    );
    assertEqual(
      await raceDialog(dialogs.showWarningMessage('warn text no options', {})),
      PENDING_LABEL,
      'showWarningMessage without options stays open awaiting user',
    );
    assertEqual(
      await raceDialog(dialogs.showInputBox({ placeHolder: 'placeholder', prompt: 'prompt' })),
      PENDING_LABEL,
      'showInputBox with options stays open awaiting user',
    );
    assertEqual(
      await raceDialog(dialogs.showInputBox({})),
      PENDING_LABEL,
      'showInputBox without options stays open awaiting user',
    );
    assertEqual(
      await raceDialog(dialogs.showQuickPick(['one', 'two'], {})),
      PENDING_LABEL,
      'showQuickPick stays open awaiting user',
    );
  });
});
