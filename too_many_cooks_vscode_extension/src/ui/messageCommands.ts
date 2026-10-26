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

function hasStringProp(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return typeof value[key] === 'string';
}

function hasNumberProp(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return typeof value[key] === 'number';
}

function isMessage(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null) { return false; }
  const record: Readonly<Record<string, unknown>> = { ...value };
  return (
    hasStringProp(record, 'id') &&
    hasStringProp(record, 'fromAgent') &&
    hasStringProp(record, 'toAgent') &&
    hasStringProp(record, 'content') &&
    hasNumberProp(record, 'createdAt')
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

export function registerCopyMessageContentCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.copyMessageContent',
    async (item?: unknown, selection?: readonly unknown[]): Promise<void> => {
      const messages: readonly Message[] = collectMessages(item, selection);
      const text: string = messages
        .map((msg: Readonly<Message>): string => { return msg.content; })
        .join('\n\n');
      await copyToClipboard(text, `Copied ${String(messages.length)} message(s) content`);
    },
  );
}

export function registerCopyMessageAsQuoteCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.copyMessageAsQuote',
    async (item?: unknown, selection?: readonly unknown[]): Promise<void> => {
      const messages: readonly Message[] = collectMessages(item, selection);
      const text: string = messages.map(formatMessageQuote).join('\n');
      await copyToClipboard(text, `Copied ${String(messages.length)} quoted message(s)`);
    },
  );
}

export function registerCopyMessageIdCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.copyMessageId',
    async (item?: unknown, selection?: readonly unknown[]): Promise<void> => {
      const messages: readonly Message[] = collectMessages(item, selection);
      const text: string = messages
        .map((msg: Readonly<Message>): string => { return msg.id; })
        .join('\n');
      await copyToClipboard(text, `Copied ${String(messages.length)} message ID(s)`);
    },
  );
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

export function registerCopyMessagesCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.copyMessages',
    async (item?: unknown, selection?: readonly unknown[]): Promise<void> => {
      const messages: readonly Message[] = collectMessages(item, selection);
      const text: string = messages
        .map((msg: Readonly<Message>): string => {
          return `[${new Date(msg.createdAt).toISOString()}] ` +
            `${msg.fromAgent} → ${formatTarget(msg.toAgent)}\n${msg.content}`;
        })
        .join('\n\n---\n\n');
      await copyToClipboard(text, `Copied ${String(messages.length)} message(s)`);
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
