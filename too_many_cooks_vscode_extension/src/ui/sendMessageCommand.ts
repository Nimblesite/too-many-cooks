// Send message command — extracted from extension.ts to keep file under 300 LOC.

import * as vscode from 'vscode';
import type { AgentIdentity } from '../state/types';
import type { DialogService } from '../services/dialogService';
import type { StoreManager } from '../services/storeManager';
import { getAgentNameFromItem } from './tree/treeItemUtils';
import { getDialogService } from '../services/dialogService';

 
const MESSAGE_PREVIEW_LENGTH: number = 50;

export function registerSendMessageCommand(
  storeManager: Readonly<StoreManager>,
  logFn: (message: string) => void,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.sendMessage',
     
    async (item?: vscode.TreeItem, selection?: readonly vscode.TreeItem[]): Promise<void> => {
      await handleSendMessage(storeManager, logFn, { item, selection });
    },
  );
}

interface SendInvocation {
   
  readonly item: vscode.TreeItem | undefined;
  readonly selection: readonly vscode.TreeItem[] | undefined;
}

interface DeliverArgs {
  readonly content: string;
  readonly fromAgent: string;
  readonly recipients: readonly string[];
  readonly storeManager: Readonly<StoreManager>;
}

function pickItems(invocation: Readonly<SendInvocation>): readonly vscode.TreeItem[] {
  const { item, selection }: Readonly<SendInvocation> = invocation;
  if (typeof selection !== 'undefined' && selection.length > 0) { return selection; }
  if (typeof item === 'undefined') { return []; }
  return [item];
}

function collectRecipients(invocation: Readonly<SendInvocation>): readonly string[] {
  const source: readonly vscode.TreeItem[] = pickItems(invocation);
  const names: string[] = [];
  for (const candidate of source) {
    const name: string | null = getAgentNameFromItem(candidate);
    if (name !== null && !names.includes(name)) { names.push(name); }
  }
  return names;
}

async function handleSendMessage(
  storeManager: Readonly<StoreManager>,
  logFn: (message: string) => void,
  invocation: Readonly<SendInvocation>,
): Promise<void> {
  const dialogs: DialogService = getDialogService();
  const recipients: readonly string[] = await selectRecipients(storeManager, invocation);
  if (recipients.length === 0) { return; }

  const fromAgent: string | undefined = await dialogs.showQuickPick(
    storeManager.state.agents.map(
      (agent: Readonly<AgentIdentity>): string => { return agent.agentName; },
    ),
    { placeHolder: 'Send as which agent?' },
  );
  if (typeof fromAgent === 'undefined') { return; }

  const targetsLabel: string = recipients.join(', ');
  const content: string | undefined = await dialogs.showInputBox({
    placeHolder: 'Enter your message...',
    prompt: `Message to ${targetsLabel}`,
  });
  if (typeof content === 'undefined') { return; }

  await deliverMessages(logFn, { content, fromAgent, recipients, storeManager });
}

async function deliverMessages(
  logFn: (message: string) => void,
  args: Readonly<DeliverArgs>,
): Promise<void> {
  const dialogs: DialogService = getDialogService();
  const { content, fromAgent, recipients, storeManager }: Readonly<DeliverArgs> = args;
  const preview: string = content.length > MESSAGE_PREVIEW_LENGTH
    ? `${content.substring(0, MESSAGE_PREVIEW_LENGTH)}...`
    : content;
  for (const toAgent of recipients) {
    try {
      await storeManager.sendMessage(fromAgent, toAgent, content);
      logFn(`Message sent from ${fromAgent} to ${toAgent}: ${content}`);
    } catch (err: unknown) {
      logFn(`Failed to send message to ${toAgent}: ${String(err)}`);
      await dialogs.showErrorMessage(`Failed to send message to ${toAgent}: ${String(err)}`);
      return;
    }
  }
  await dialogs.showInformationMessage(
    `Message sent to ${String(recipients.length)} recipient(s): "${preview}"`,
  );
}

async function selectRecipients(
  storeManager: Readonly<StoreManager>,
  invocation: Readonly<SendInvocation>,
): Promise<readonly string[]> {
  const fromSelection: readonly string[] = collectRecipients(invocation);
  if (fromSelection.length > 0) { return fromSelection; }

  const fallback: string | null = await selectRecipient(storeManager, invocation.item);
  return fallback === null ? [] : [fallback];
}

async function selectRecipient(
  storeManager: Readonly<StoreManager>,
   
  item?: vscode.TreeItem,
): Promise<string | null> {
  const fromItem: string | null = getAgentNameFromItem(item);
  if (fromItem !== null) { return fromItem; }

  const dialogs: DialogService = getDialogService();
  if (!storeManager.isConnected) {
    await dialogs.showErrorMessage('Not connected to server');
    return null;
  }
  const agentNames: string[] = [
    '* (broadcast to all)',
    ...storeManager.state.agents.map(
      (agent: Readonly<AgentIdentity>): string => { return agent.agentName; },
    ),
  ];
  const picked: string | undefined = await dialogs.showQuickPick(agentNames, {
    placeHolder: 'Select recipient agent',
  });
  if (typeof picked === 'undefined') { return null; }
  if (picked === '* (broadcast to all)') { return '*'; }
  return picked;
}
