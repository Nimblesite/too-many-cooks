// TreeDataProvider for file locks view.

import * as vscode from 'vscode';
import type { AppState, FileLock } from '../../state/types';
import { selectActiveLocks, selectExpiredLocks } from '../../state/selectors';
import type { LockTiming } from './lockTiming';
import { LockTreeItem } from './lockTreeItem';
import type { StoreManager } from '../../services/storeManager';
import { StoreTreeProviderBase } from './storeTreeProviderBase';
import { getLockTiming } from './lockTiming';

/** One top-level lock category: label, expanded state and its selector. */
interface LockSection {
  readonly collapsibleState: vscode.TreeItemCollapsibleState;
  readonly label: string;
  readonly select: (state: Readonly<AppState>) => readonly FileLock[];
}

const SECTION_ACTIVE: LockSection = {
  collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
  label: 'Active',
  select: selectActiveLocks,
};

const SECTION_EXPIRED: LockSection = {
  collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
  label: 'Expired',
  select: selectExpiredLocks,
};

const LOCK_SECTIONS: readonly LockSection[] = [SECTION_ACTIVE, SECTION_EXPIRED];

export class LocksTreeProvider extends StoreTreeProviderBase<LockTreeItem> {
  public constructor(storeManager: Readonly<StoreManager>) {
    super(storeManager);
  }

 
  public getChildren(element?: LockTreeItem): LockTreeItem[] {
    if (typeof element === 'undefined') {
      return this.getRootItems();
    }

    if (element.isCategory) {
      return this.getCategoryChildren(element);
    }

    return [];
  }

  private getRootItems(): LockTreeItem[] {
    const { state }: Readonly<StoreManager> = this.storeManager;
    const items: LockTreeItem[] = [];

    for (const section of LOCK_SECTIONS) {
      const locks: readonly FileLock[] = section.select(state);
      if (locks.length > 0) {
        items.push(createCategoryItem(
          `${section.label} (${String(locks.length)})`,
          section.collapsibleState,
        ));
      }
    }

    if (items.length === 0) {
      items.push(new LockTreeItem({
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        isCategory: false,
        label: 'No locks',
        lock: null,
      }));
    }

    return items;
  }

   
  private getCategoryChildren(element: LockTreeItem): LockTreeItem[] {
    const rawLabel: vscode.TreeItemLabel | string | undefined = element.label;
    const label: string = typeof rawLabel === 'string' ? rawLabel : '';
    const section: LockSection = label.startsWith(SECTION_ACTIVE.label)
      ? SECTION_ACTIVE
      : SECTION_EXPIRED;
    const { state }: Readonly<StoreManager> = this.storeManager;
    const now: number = Date.now();

    return section.select(state).map((lock: Readonly<FileLock>): LockTreeItem => {
      return createLockItem(lock, now);
    });
  }
}

function createCategoryItem(
  label: string,
  collapsibleState: vscode.TreeItemCollapsibleState,
): LockTreeItem {
  const item: LockTreeItem = new LockTreeItem({
    collapsibleState,
    isCategory: true,
    label,
    lock: null,
  });
  item.iconPath = new vscode.ThemeIcon('folder');
  item.contextValue = 'category';
  return item;
}

function createLockItem(lock: Readonly<FileLock>, now: number): LockTreeItem {
  const { expired, expiresIn }: LockTiming = getLockTiming(lock, now);
  let desc: string;
  if (expired) {
    desc = `${lock.agentName} - EXPIRED`;
  } else {
    desc = `${lock.agentName} - ${String(expiresIn)}s`;
  }

  const item: LockTreeItem = new LockTreeItem({
    collapsibleState: vscode.TreeItemCollapsibleState.None,
    isCategory: false,
    label: lock.filePath,
    lock,
  });
  item.description = desc;
  item.contextValue = 'lock';
  item.tooltip = createLockTooltip(lock);
  item.command = {
    arguments: [vscode.Uri.file(lock.filePath)],
    command: 'vscode.open',
    title: 'Open File',
  };

  if (expired) {
    item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
  } else {
    item.iconPath = new vscode.ThemeIcon('lock');
  }

  return item;
}

function createLockTooltip(lock: Readonly<FileLock>): vscode.MarkdownString {
  const { expired, expiresIn }: LockTiming = getLockTiming(lock, Date.now());
  const md: vscode.MarkdownString = new vscode.MarkdownString();
  md.appendMarkdown(`**${lock.filePath}**\n\n`);
  md.appendMarkdown(`- **Agent:** ${lock.agentName}\n`);
  if (expired) {
    md.appendMarkdown('- **Status:** **EXPIRED**\n');
  } else {
    md.appendMarkdown('- **Status:** Active\n');
    md.appendMarkdown(`- **Expires in:** ${String(expiresIn)}s\n`);
  }
  if (lock.reason !== null) {
    md.appendMarkdown(`- **Reason:** ${lock.reason}\n`);
  }
  return md;
}