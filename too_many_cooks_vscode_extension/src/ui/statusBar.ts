// Status bar item showing connection mode, transport, and agent/lock/message counts.
//
// Phase 5 of the VSIX connection switcher.
// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md

import * as vscode from 'vscode';
import type { AppState, ConnectionStatus } from '../state/types';
import { selectAgentCount, selectConnectionStatus, selectLockCount, selectModeLabel, selectUnreadMessageCount } from '../state/selectors';
import type { StoreManager } from '../services/storeManager';

/** Status bar command — opens connection picker. */
const STATUS_BAR_COMMAND: string = 'tooManyCooks.chooseConnection';

function pluralSuffix(count: number): string {
  if (count === 1) {
    return '';
  }
  return 's';
}

export class StatusBarManager {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly unsubscribe: () => void;

  public constructor(storeManager: Readonly<StoreManager>) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    this.statusBarItem.command = STATUS_BAR_COMMAND;

    this.unsubscribe = storeManager.subscribe((): void => { this.update(storeManager); });
    this.update(storeManager);
    this.statusBarItem.show();
  }

  private update(storeManager: Readonly<StoreManager>): void {
    const status: ConnectionStatus = selectConnectionStatus(storeManager.state);

    let background: vscode.ThemeColor | null = null;

    switch (status) {
      case 'disconnected':
        this.statusBarItem.text = '$(debug-disconnect) TMC: Disconnected';
        this.statusBarItem.tooltip = 'Click to choose connection mode';
        background = new vscode.ThemeColor('statusBarItem.errorBackground');
        break;
      case 'connecting':
        this.statusBarItem.text = '$(sync~spin) TMC: Connecting...';
        this.statusBarItem.tooltip = 'Connecting to Too Many Cooks server';
        background = new vscode.ThemeColor('statusBarItem.warningBackground');
        break;
      case 'connected':
        this.updateConnected(storeManager);
        break;
      default:
        break;
    }

    if (background === null) {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBar.background');
    } else {
      this.statusBarItem.backgroundColor = background;
    }
  }

  private updateConnected(storeManager: Readonly<StoreManager>): void {
    const { state }: { readonly state: AppState } = storeManager;
    const agents: number = selectAgentCount(state);
    const locks: number = selectLockCount(state);
    const unread: number = selectUnreadMessageCount(state);
    const modeLabel: string = selectModeLabel(selectConnectionStatus(state), storeManager.getTarget());
    this.statusBarItem.text =
      `$(check) TMC: ${modeLabel}  $(person) ${String(agents)}  $(lock) ${String(locks)}  $(mail) ${String(unread)}`;
    this.statusBarItem.tooltip = [
      `Mode: ${modeLabel}`,
      `${String(agents)} agent${pluralSuffix(agents)}`,
      `${String(locks)} lock${pluralSuffix(locks)}`,
      `${String(unread)} unread message${pluralSuffix(unread)}`,
      '',
      'Click to change connection',
    ].join('\n');
  }

  public dispose(): void {
    this.unsubscribe();
    this.statusBarItem.dispose();
  }
}
