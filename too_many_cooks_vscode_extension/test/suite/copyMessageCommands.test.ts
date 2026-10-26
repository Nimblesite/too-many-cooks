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

function makeAgentItem(agentName: string): unknown {
  return { agentName };
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
    await writeClipboard(SENTINEL);
    const selection: unknown[] = [makeMessageItem(FIRST), makeMessageItem(SECOND)];
    await vscode.commands.executeCommand(CMD_COPY_CONTENT, undefined, selection);

    assertEqual(
      await readClipboard(),
      `${FIRST.content}${SEPARATOR_BLANK_LINE}${SECOND.content}`,
      'selected message contents joined with blank lines',
    );
  });

  test('copyMessageAsQuote formats "from → to: content"', async () => {
    await writeClipboard(SENTINEL);
    await vscode.commands.executeCommand(CMD_COPY_QUOTE, makeMessageItem(FIRST));

    assertEqual(await readClipboard(), expectedQuote(FIRST), 'single-message quote format');
  });

  test('copyMessageAsQuote renders broadcast target as "all"', async () => {
    await writeClipboard(SENTINEL);
    await vscode.commands.executeCommand(CMD_COPY_QUOTE, makeMessageItem(SECOND));

    assertEqual(
      await readClipboard(),
      expectedQuote(SECOND),
      'broadcast recipient becomes "all"',
    );
  });

  test('copyMessageId joins message ids', async () => {
    await writeClipboard(SENTINEL);
    const selection: unknown[] = [makeMessageItem(FIRST), makeMessageItem(SECOND)];
    await vscode.commands.executeCommand(CMD_COPY_ID, undefined, selection);

    assertEqual(await readClipboard(), `${FIRST.id}\n${SECOND.id}`, 'ids joined with newlines');
  });

  test('copyMessageSender deduplicates senders in order', async () => {
    await writeClipboard(SENTINEL);
    const selection: unknown[] = [
      makeMessageItem(FIRST),
      makeMessageItem(THIRD),
      makeMessageItem(SECOND),
    ];
    await vscode.commands.executeCommand(CMD_COPY_SENDER, undefined, selection);

    assertEqual(await readClipboard(), `${AGENT_ALICE}\n${AGENT_BOB}`, 'distinct senders only');
  });

  test('copyMessageRecipient deduplicates recipients and maps broadcast', async () => {
    await writeClipboard(SENTINEL);
    const selection: unknown[] = [
      makeMessageItem(FIRST),
      makeMessageItem(SECOND),
      makeMessageItem(THIRD),
    ];
    await vscode.commands.executeCommand(CMD_COPY_RECIPIENT, undefined, selection);

    assertEqual(await readClipboard(), `${AGENT_BOB}\n${BROADCAST_LABEL}`, 'bob then all');
  });

  test('copyMessages writes the full timestamped format', async () => {
    await writeClipboard(SENTINEL);
    const selection: unknown[] = [makeMessageItem(FIRST), makeMessageItem(SECOND)];
    await vscode.commands.executeCommand(CMD_COPY_MESSAGES, undefined, selection);

    const expected: string =
      `${expectedFullLine(FIRST)}${SEPARATOR_MESSAGES}${expectedFullLine(SECOND)}`;
    assertEqual(await readClipboard(), expected, 'full message format');
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
    await writeClipboard(SENTINEL);
    await vscode.commands.executeCommand(CMD_COPY_CONTENT);
    assertEqual(await readClipboard(), SENTINEL, 'no item leaves clipboard alone');

    await writeClipboard(SENTINEL);
    await vscode.commands.executeCommand(CMD_COPY_CONTENT, 'not-an-object');
    assertEqual(await readClipboard(), SENTINEL, 'primitive item leaves clipboard alone');

    await writeClipboard(SENTINEL);
    await vscode.commands.executeCommand(CMD_COPY_CONTENT, { other: 'x' });
    assertEqual(await readClipboard(), SENTINEL, 'item without message leaves clipboard alone');

    await writeClipboard(SENTINEL);
    const incomplete: unknown = { message: { content: 'c', fromAgent: 'a', id: 'i', toAgent: 't' } };
    await vscode.commands.executeCommand(CMD_COPY_CONTENT, incomplete);
    assertEqual(await readClipboard(), SENTINEL, 'message missing createdAt leaves clipboard alone');

    await writeClipboard(SENTINEL);
    await vscode.commands.executeCommand(CMD_COPY_CONTENT, { message: null });
    assertEqual(await readClipboard(), SENTINEL, 'null message leaves clipboard alone');
  });

  test('copyAgentName rejects null, missing, and non-string agent names', async () => {
    await writeClipboard(SENTINEL);
    await vscode.commands.executeCommand(CMD_COPY_AGENT_NAME, null);
    assertEqual(await readClipboard(), SENTINEL, 'null item leaves clipboard alone');

    await writeClipboard(SENTINEL);
    await vscode.commands.executeCommand(CMD_COPY_AGENT_NAME, { other: 'x' });
    assertEqual(await readClipboard(), SENTINEL, 'item without agentName leaves clipboard alone');

    await writeClipboard(SENTINEL);
    await vscode.commands.executeCommand(CMD_COPY_AGENT_NAME, { agentName: 42 });
    assertEqual(await readClipboard(), SENTINEL, 'non-string agentName leaves clipboard alone');
  });
});
