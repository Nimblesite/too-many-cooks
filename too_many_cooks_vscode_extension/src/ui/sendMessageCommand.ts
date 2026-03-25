// Send message command — extracted from extension.ts to keep file under 300 LOC.

import * as vscode from 'vscode';
import type { AgentIdentity } from '../state/types';
import type { DialogService } from '../services/dialogService';
import type { StoreManager } from '../services/storeManager';
import { getAgentNameFromItem } from './tree/treeItemUtils';
import { getDialogService } from '../services/dialogService';

// eslint-disable-next-line @typescript-eslint/no-inferrable-types
const MESSAGE_PREVIEW_LENGTH: number = 50;

export function registerSendMessageCommand(
  storeManager: Readonly<StoreManager>,
  logFn: (message: string) => void,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.sendMessage',
    // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
    async (item?: vscode.TreeItem): Promise<void> => {
      await handleSendMessage(storeManager, logFn, item);
    },
  );
}

async function handleSendMessage(
  storeManager: Readonly<StoreManager>,
  logFn: (message: string) => void,
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  item?: vscode.TreeItem,
): Promise<void> {
  const dialogs: DialogService = getDialogService();
  const toAgent: string | null = await selectRecipient(storeManager, item);
  if (toAgent === null) { return; }

  const fromAgent: string | undefined = await dialogs.showQuickPick(
    storeManager.state.agents.map(
      (agent: Readonly<AgentIdentity>): string => { return agent.agentName; },
    ),
    { placeHolder: 'Send as which agent?' },
  );
  if (typeof fromAgent === 'undefined') { return; }

  const content: string | undefined = await dialogs.showInputBox({
    placeHolder: 'Enter your message...',
    prompt: `Message to ${toAgent}`,
  });
  if (typeof content === 'undefined') { return; }

  try {
    await storeManager.sendMessage(fromAgent, toAgent, content);
    const preview: string = content.length > MESSAGE_PREVIEW_LENGTH
      ? `${content.substring(0, MESSAGE_PREVIEW_LENGTH)}...`
      : content;
    await dialogs.showInformationMessage(`Message sent to ${toAgent}: "${preview}"`);
    logFn(`Message sent from ${fromAgent} to ${toAgent}: ${content}`);
  } catch (err: unknown) {
    logFn(`Failed to send message: ${String(err)}`);
    await dialogs.showErrorMessage(`Failed to send message: ${String(err)}`);
  }
}

async function selectRecipient(
  storeManager: Readonly<StoreManager>,
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
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
