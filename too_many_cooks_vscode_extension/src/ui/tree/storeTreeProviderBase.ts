// Shared base for tree providers that re-render whenever the store changes.

import * as vscode from 'vscode';
import type { StoreManager } from '../../services/storeManager';

export abstract class StoreTreeProviderBase<TItem extends vscode.TreeItem>
  implements vscode.TreeDataProvider<TItem>
{
  protected readonly changeEmitter: vscode.EventEmitter<TItem | null> =
    new vscode.EventEmitter<TItem | null>();

  public readonly onDidChangeTreeData: vscode.Event<TItem | null> =
    this.changeEmitter.event;

  private readonly unsubscribe: () => void;

  protected constructor(protected readonly storeManager: Readonly<StoreManager>) {
    this.unsubscribe = storeManager.subscribe((): void => {
      this.changeEmitter.fire(null);
    });
  }

  public getTreeItem(element: TItem): vscode.TreeItem {
    return element;
  }

  public abstract getChildren(element?: TItem): TItem[];

  public dispose(): void {
    this.unsubscribe();
    this.changeEmitter.dispose();
  }
}
