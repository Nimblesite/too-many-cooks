// Context-menu copy commands for the Messages and Agents tree views.
// Each command accepts the clicked item plus the full selection so that
// Multi-select context-menu invocations copy the whole selection.

import * as vscode from 'vscode';
import { collectDistinct, pickSelection } from './treeSelection';
import type { DialogService } from '../services/dialogService';
import type { Message } from '../state/types';
import { getDialogService } from '../services/dialogService';

const BROADCAST_TARGET: string = '*';
const BROADCAST_LABEL: string = 'all';

function hasMessage(value: object): value is { readonly message: unknown } {
  return 'message' in value;
}

function hasPrimitiveProp(
  value: Readonly<Record<string, unknown>>,
  key: string,
  kind: 'number' | 'string',
): boolean {
  return typeof value[key] === kind;
}

function isMessage(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null) { return false; }
  const record: Readonly<Record<string, unknown>> = { ...value };
  return (
    hasPrimitiveProp(record, 'id', 'string') &&
    hasPrimitiveProp(record, 'fromAgent', 'string') &&
    hasPrimitiveProp(record, 'toAgent', 'string') &&
    hasPrimitiveProp(record, 'content', 'string') &&
    hasPrimitiveProp(record, 'createdAt', 'number')
  );
}

function extractMessage(item: unknown): Message | null {
  if (typeof item !== 'object' || item === null) { return null; }
  if (!hasMessage(item)) { return null; }
  const candidate: unknown = item.message;
  if (!isMessage(candidate)) { return null; }
  return candidate;
}

function hasAgentName(value: object): value is { readonly agentName: unknown } {
  return 'agentName' in value;
}

function extractAgentName(item: unknown): string | null {
  if (typeof item !== 'object' || item === null) { return null; }
  if (!hasAgentName(item)) { return null; }
  const candidate: unknown = item.agentName;
  if (typeof candidate !== 'string') { return null; }
  return candidate;
}

function collectMessages(
  item: unknown,
  selection: readonly unknown[] | undefined,
): readonly Message[] {
  const extracted: ReadonlyArray<Message | null> = pickSelection(item, selection).map(extractMessage);
  const messages: Message[] = [];
  for (const msg of extracted) {
    if (msg !== null) { messages.push(msg); }
  }
  return messages;
}

function collectAgentNames(
  item: unknown,
  selection: readonly unknown[] | undefined,
): readonly string[] {
  return collectDistinct(pickSelection(item, selection), extractAgentName);
}

function formatTarget(toAgent: string): string {
  return toAgent === BROADCAST_TARGET ? BROADCAST_LABEL : toAgent;
}

function formatMessageQuote(msg: Readonly<Message>): string {
  return `${msg.fromAgent} → ${formatTarget(msg.toAgent)}: ${msg.content}`;
}

async function copyToClipboard(value: string, successMessage: string): Promise<void> {
  const dialogs: DialogService = getDialogService();
  if (value.length === 0) {
    await dialogs.showErrorMessage('Nothing to copy');
    return;
  }
  await vscode.env.clipboard.writeText(value);
  await dialogs.showInformationMessage(successMessage);
}

interface MapCopySpec {
  readonly commandId: string;
  readonly extractor: (msg: Readonly<Message>) => string;
  readonly separator: string;
  readonly successLabel: string;
}

function registerMapCopyCommand(spec: Readonly<MapCopySpec>): vscode.Disposable {
  return vscode.commands.registerCommand(
    spec.commandId,
    async (item?: unknown, selection?: readonly unknown[]): Promise<void> => {
      const messages: readonly Message[] = collectMessages(item, selection);
      const text: string = messages.map(spec.extractor).join(spec.separator);
      await copyToClipboard(text, `Copied ${String(messages.length)} ${spec.successLabel}`);
    },
  );
}

export function registerCopyMessageContentCommand(): vscode.Disposable {
  return registerMapCopyCommand({
    commandId: 'tooManyCooks.copyMessageContent',
    extractor: (msg: Readonly<Message>): string => { return msg.content; },
    separator: '\n\n',
    successLabel: 'message(s) content',
  });
}

export function registerCopyMessageAsQuoteCommand(): vscode.Disposable {
  return registerMapCopyCommand({
    commandId: 'tooManyCooks.copyMessageAsQuote',
    extractor: formatMessageQuote,
    separator: '\n',
    successLabel: 'quoted message(s)',
  });
}

export function registerCopyMessageIdCommand(): vscode.Disposable {
  return registerMapCopyCommand({
    commandId: 'tooManyCooks.copyMessageId',
    extractor: (msg: Readonly<Message>): string => { return msg.id; },
    separator: '\n',
    successLabel: 'message ID(s)',
  });
}

export function registerCopyMessagesCommand(): vscode.Disposable {
  return registerMapCopyCommand({
    commandId: 'tooManyCooks.copyMessages',
    extractor: (msg: Readonly<Message>): string => {
      return `[${new Date(msg.createdAt).toISOString()}] ` +
        `${msg.fromAgent} → ${formatTarget(msg.toAgent)}\n${msg.content}`;
    },
    separator: '\n\n---\n\n',
    successLabel: 'message(s)',
  });
}

export function registerCopyMessageSenderCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.copyMessageSender',
    async (item?: unknown, selection?: readonly unknown[]): Promise<void> => {
      const messages: readonly Message[] = collectMessages(item, selection);
      const senders: string[] = [];
      for (const msg of messages) {
        if (!senders.includes(msg.fromAgent)) { senders.push(msg.fromAgent); }
      }
      await copyToClipboard(senders.join('\n'), `Copied ${String(senders.length)} sender(s)`);
    },
  );
}

export function registerCopyMessageRecipientCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.copyMessageRecipient',
    async (item?: unknown, selection?: readonly unknown[]): Promise<void> => {
      const messages: readonly Message[] = collectMessages(item, selection);
      const recipients: string[] = [];
      for (const msg of messages) {
        const target: string = formatTarget(msg.toAgent);
        if (!recipients.includes(target)) { recipients.push(target); }
      }
      await copyToClipboard(
        recipients.join('\n'),
        `Copied ${String(recipients.length)} recipient(s)`,
      );
    },
  );
}

export function registerCopyAgentNameCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.copyAgentName',
    async (item?: unknown, selection?: readonly unknown[]): Promise<void> => {
      const names: readonly string[] = collectAgentNames(item, selection);
      await copyToClipboard(names.join('\n'), `Copied ${String(names.length)} agent name(s)`);
    },
  );
}
