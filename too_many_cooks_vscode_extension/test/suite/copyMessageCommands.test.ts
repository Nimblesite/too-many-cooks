// Copy-message context-menu commands E2E.
//
// Drives every tooManyCooks.copy* command through vscode.commands.executeCommand
// (the only supported black-box entry point) with duck-typed tree items, then
// asserts the exact clipboard output. Also proves the "Nothing to copy" guard
// leaves the clipboard untouched when a selection carries no valid message.

import * as vscode from 'vscode';

import {
  assertEqual,
  installDialogMocks,
  makeAgentItem,
  restoreDialogMocks,
  waitForExtensionActivation,
} from './testHelpers';

const CMD_COPY_CONTENT = 'tooManyCooks.copyMessageContent';
const CMD_COPY_QUOTE = 'tooManyCooks.copyMessageAsQuote';
const CMD_COPY_ID = 'tooManyCooks.copyMessageId';
const CMD_COPY_SENDER = 'tooManyCooks.copyMessageSender';
const CMD_COPY_RECIPIENT = 'tooManyCooks.copyMessageRecipient';
const CMD_COPY_MESSAGES = 'tooManyCooks.copyMessages';
const CMD_COPY_AGENT_NAME = 'tooManyCooks.copyAgentName';

const BROADCAST = '*';
const BROADCAST_LABEL = 'all';
const SENTINEL = 'clipboard-sentinel-untouched';

const AGENT_ALICE = 'alice';
const AGENT_BOB = 'bob';

const SEPARATOR_BLANK_LINE = '\n\n';
const SEPARATOR_MESSAGES = '\n\n---\n\n';

interface MessageRecord {
  readonly content: string;
  readonly createdAt: number;
  readonly fromAgent: string;
  readonly id: string;
  readonly toAgent: string;
}

const FIRST: MessageRecord = {
  content: 'first message body',
  createdAt: 1700000000000,
  fromAgent: AGENT_ALICE,
  id: 'msg-1',
  toAgent: AGENT_BOB,
};

const SECOND: MessageRecord = {
  content: 'second message body',
  createdAt: 1700000001000,
  fromAgent: AGENT_BOB,
  id: 'msg-2',
  toAgent: BROADCAST,
};

const THIRD: MessageRecord = {
  content: 'third message body',
  createdAt: 1700000002000,
  fromAgent: AGENT_ALICE,
  id: 'msg-3',
  toAgent: AGENT_BOB,
};

function makeMessageItem(message: MessageRecord): unknown {
  return { message };
}

/** Invoke a copy command over message items and return the clipboard text. */
async function copySelection(command: string, ...messages: readonly MessageRecord[]): Promise<string> {
  await writeClipboard(SENTINEL);
  await vscode.commands.executeCommand(command, undefined, messages.map(makeMessageItem));
  return await readClipboard();
}

async function writeClipboard(value: string): Promise<void> {
  await vscode.env.clipboard.writeText(value);
}

async function readClipboard(): Promise<string> {
  return await vscode.env.clipboard.readText();
}

function expectedQuote(message: MessageRecord): string {
  const target: string = message.toAgent === BROADCAST ? BROADCAST_LABEL : message.toAgent;
  return `${message.fromAgent} → ${target}: ${message.content}`;
}

/** Assert the clipboard still holds the sentinel after a command invocation. */
async function assertClipboardUnchanged(assertion: string, command: string, ...args: readonly unknown[]): Promise<void> {
  await writeClipboard(SENTINEL);
  await vscode.commands.executeCommand(command, ...args);
  assertEqual(await readClipboard(), SENTINEL, assertion);
}

/** Single-message quote cases: one direct message and one broadcast. */
const QUOTE_CASES: readonly { readonly assertion: string; readonly message: MessageRecord; readonly name: string }[] = [
  { assertion: 'single-message quote format', message: FIRST, name: 'copyMessageAsQuote formats "from → to: content"' },
  { assertion: 'broadcast recipient becomes "all"', message: SECOND, name: 'copyMessageAsQuote renders broadcast target as "all"' },
];

function expectedFullLine(message: MessageRecord): string {
  const timestamp: string = new Date(message.createdAt).toISOString();
  const target: string = message.toAgent === BROADCAST ? BROADCAST_LABEL : message.toAgent;
  return `[${timestamp}] ${message.fromAgent} → ${target}\n${message.content}`;
}

suite('Copy Message Commands', () => {
  suiteSetup(async () => {
    await waitForExtensionActivation();
    installDialogMocks();
  });

  suiteTeardown(() => {
    restoreDialogMocks();
  });

  test('copyMessageContent joins selected contents with blank lines', async () => {
    assertEqual(
      await copySelection(CMD_COPY_CONTENT, FIRST, SECOND),
      `${FIRST.content}${SEPARATOR_BLANK_LINE}${SECOND.content}`,
      'selected message contents joined with blank lines',
    );
  });

  for (const quoteCase of QUOTE_CASES) {
    test(quoteCase.name, async () => {
      await writeClipboard(SENTINEL);
      await vscode.commands.executeCommand(CMD_COPY_QUOTE, makeMessageItem(quoteCase.message));

      assertEqual(await readClipboard(), expectedQuote(quoteCase.message), quoteCase.assertion);
    });
  }

  test('copyMessageId joins message ids', async () => {
    assertEqual(
      await copySelection(CMD_COPY_ID, FIRST, SECOND),
      `${FIRST.id}\n${SECOND.id}`,
      'ids joined with newlines',
    );
  });

  test('copyMessageSender deduplicates senders in order', async () => {
    assertEqual(
      await copySelection(CMD_COPY_SENDER, FIRST, THIRD, SECOND),
      `${AGENT_ALICE}\n${AGENT_BOB}`,
      'distinct senders only',
    );
  });

  test('copyMessageRecipient deduplicates recipients and maps broadcast', async () => {
    assertEqual(
      await copySelection(CMD_COPY_RECIPIENT, FIRST, SECOND, THIRD),
      `${AGENT_BOB}\n${BROADCAST_LABEL}`,
      'bob then all',
    );
  });

  test('copyMessages writes the full timestamped format', async () => {
    const expected: string =
      `${expectedFullLine(FIRST)}${SEPARATOR_MESSAGES}${expectedFullLine(SECOND)}`;
    assertEqual(
      await copySelection(CMD_COPY_MESSAGES, FIRST, SECOND),
      expected,
      'full message format',
    );
  });

  test('copyAgentName deduplicates agent names in order', async () => {
    await writeClipboard(SENTINEL);
    const selection: unknown[] = [
      makeAgentItem(AGENT_ALICE),
      makeAgentItem(AGENT_ALICE),
      makeAgentItem(AGENT_BOB),
    ];
    await vscode.commands.executeCommand(CMD_COPY_AGENT_NAME, undefined, selection);

    assertEqual(await readClipboard(), `${AGENT_ALICE}\n${AGENT_BOB}`, 'distinct agent names');
  });

  test('invalid or missing selections leave the clipboard untouched', async () => {
    const incomplete: unknown = { message: { content: 'c', fromAgent: 'a', id: 'i', toAgent: 't' } };
    const cases: readonly (readonly [string, readonly unknown[]])[] = [
      ['no item leaves clipboard alone', []],
      ['primitive item leaves clipboard alone', ['not-an-object']],
      ['item without message leaves clipboard alone', [{ other: 'x' }]],
      ['message missing createdAt leaves clipboard alone', [incomplete]],
      ['null message leaves clipboard alone', [{ message: null }]],
    ];
    for (const [assertion, args] of cases) {
      await assertClipboardUnchanged(assertion, CMD_COPY_CONTENT, ...args);
    }
  });

  test('copyAgentName rejects null, missing, and non-string agent names', async () => {
    const cases: readonly (readonly [string, readonly unknown[]])[] = [
      ['null item leaves clipboard alone', [null]],
      ['item without agentName leaves clipboard alone', [{ other: 'x' }]],
      ['non-string agentName leaves clipboard alone', [{ agentName: 42 }]],
    ];
    for (const [assertion, args] of cases) {
      await assertClipboardUnchanged(assertion, CMD_COPY_AGENT_NAME, ...args);
    }
  });
});
