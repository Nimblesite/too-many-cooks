// Delete agent commands — extracted from extension.ts to keep file under 300 LOC.

import * as vscode from 'vscode';
import type { DialogService } from '../services/dialogService';
import type { StoreManager } from '../services/storeManager';
import { getAgentNameFromItem } from './tree/treeItemUtils';
import { getDialogService } from '../services/dialogService';

type LogFn = (msg: string) => void;

function pickItems(
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  item: vscode.TreeItem | undefined,
  selection: readonly vscode.TreeItem[] | undefined,
): readonly vscode.TreeItem[] {
  if (typeof selection !== 'undefined' && selection.length > 0) { return selection; }
  if (typeof item === 'undefined') { return []; }
  return [item];
}

function collectAgentNames(
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  item: vscode.TreeItem | undefined,
  selection: readonly vscode.TreeItem[] | undefined,
): readonly string[] {
  const source: readonly vscode.TreeItem[] = pickItems(item, selection);
  const names: string[] = [];
  for (const candidate of source) {
    const name: string | null = getAgentNameFromItem(candidate);
    if (name !== null && !names.includes(name)) { names.push(name); }
  }
  return names;
}

async function deleteAgents(
  storeManager: Readonly<StoreManager>,
  logFn: LogFn,
  names: readonly string[],
): Promise<void> {
  const dialogs: DialogService = getDialogService();
  for (const name of names) {
    try {
      await storeManager.deleteAgent(name);
      logFn(`Removed agent: ${name}`);
    } catch (err: unknown) {
      logFn(`Failed to remove agent ${name}: ${String(err)}`);
      await dialogs.showErrorMessage(`Failed to remove agent ${name}: ${String(err)}`);
      return;
    }
  }
  await dialogs.showInformationMessage(`Removed ${String(names.length)} agent(s)`);
}

export function registerDeleteAgentCommand(
  storeManager: Readonly<StoreManager>,
  logFn: LogFn,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.deleteAgent',
    // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
    async (item?: vscode.TreeItem, selection?: readonly vscode.TreeItem[]): Promise<void> => {
      const dialogs: DialogService = getDialogService();
      const names: readonly string[] = collectAgentNames(item, selection);
      if (names.length === 0) {
        await dialogs.showErrorMessage('No agent selected');
        return;
      }
      const promptMsg: string = names.length === 1
        ? `Remove agent "${names[0] ?? ''}"? This will release all their locks.`
        : `Remove ${String(names.length)} agents? This will release all their locks.`;
      const confirm: string | undefined = await dialogs.showWarningMessage(
        promptMsg,
        { modal: true },
        'Remove',
      );
      if (confirm !== 'Remove') { return; }
      await deleteAgents(storeManager, logFn, names);
    },
  );
}

export function registerDeleteAllAgentsCommand(
  storeManager: Readonly<StoreManager>,
  logFn: LogFn,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.deleteAllAgents',
    async (): Promise<void> => {
      const dialogs: DialogService = getDialogService();
      const count: number = storeManager.state.agents.length;
      if (count === 0) {
        await dialogs.showInformationMessage('No agents to remove');
        return;
      }
      const confirm: string | undefined = await dialogs.showWarningMessage(
        `Remove all ${String(count)} agents? This will release all locks.`,
        { modal: true },
        'Remove All',
      );
      if (confirm !== 'Remove All') { return; }
      try {
        await storeManager.deleteAllAgents();
        logFn(`Removed all ${String(count)} agents`);
        await dialogs.showInformationMessage(`All ${String(count)} agents removed`);
      } catch (err: unknown) {
        logFn(`Failed to remove all agents: ${String(err)}`);
        await dialogs.showErrorMessage(`Failed to remove all agents: ${String(err)}`);
      }
    },
  );
}
