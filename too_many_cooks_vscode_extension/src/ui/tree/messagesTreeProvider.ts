// TreeDataProvider for messages view.

import * as vscode from 'vscode';
import { getRelativeTime, getRelativeTimeShort } from './relativeTime';
import type { Message } from '../../state/types';
import { MessageTreeItem } from './messageTreeItem';
import type { StoreManager } from '../../services/storeManager';
import { StoreTreeProviderBase } from './storeTreeProviderBase';
import { selectMessages } from '../../state/selectors';

export class MessagesTreeProvider extends StoreTreeProviderBase<MessageTreeItem> {
  public constructor(storeManager: Readonly<StoreManager>) {
    super(storeManager);
  }

 
  public getChildren(element?: MessageTreeItem): MessageTreeItem[] {
    if (typeof element !== 'undefined') {
      return [];
    }

    const allMessages: readonly Message[] = selectMessages(this.storeManager.state);

    if (allMessages.length === 0) {
      return [new MessageTreeItem('No messages', vscode.TreeItemCollapsibleState.None, null)];
    }

    const sorted: Message[] = [...allMessages].sort(
      (msgA: Readonly<Message>, msgB: Readonly<Message>): number => {
        return msgB.createdAt - msgA.createdAt;
      },
    );

    return sorted.map((msg: Readonly<Message>): MessageTreeItem => {
      return createMessageItem(msg);
    });
  }
}

function createMessageItem(msg: Readonly<Message>): MessageTreeItem {
  let target: string;
  if (msg.toAgent === '*') {
    target = 'all';
  } else {
    target = msg.toAgent;
  }
  const relativeTime: string = getRelativeTimeShort(msg.createdAt);
   
  let statusPart: string = '';
  if (msg.readAt === null) {
    statusPart = ' [unread]';
  }

  const item: MessageTreeItem = new MessageTreeItem(
    `${msg.fromAgent} \u2192 ${target} | ${relativeTime}${statusPart}`,
    vscode.TreeItemCollapsibleState.None,
    msg,
  );
  item.description = msg.content;
  item.contextValue = 'message';
  item.tooltip = createTooltip(msg);

  if (msg.readAt === null) {
    item.iconPath = new vscode.ThemeIcon(
      'circle-filled',
      new vscode.ThemeColor('charts.yellow'),
    );
  }

  return item;
}

function createTooltip(msg: Readonly<Message>): vscode.MarkdownString {
  let target: string;
  if (msg.toAgent === '*') {
    target = 'Everyone (broadcast)';
  } else {
    target = msg.toAgent;
  }
  const quotedContent: string = msg.content.split('\n').join('\n> ');
  const sentDate: Date = new Date(msg.createdAt);
  const relativeTime: string = getRelativeTime(msg.createdAt);

  const md: vscode.MarkdownString = new vscode.MarkdownString();
  md.isTrusted = true;
  md.appendMarkdown(`### ${msg.fromAgent} \u2192 ${target}\n\n`);
  md.appendMarkdown(`> ${quotedContent}\n\n`);
  md.appendMarkdown('---\n\n');
  md.appendMarkdown(`**Sent:** ${String(sentDate)} (${relativeTime})\n\n`);

  if (msg.readAt === null) {
    md.appendMarkdown('**Status:** Unread\n\n');
  } else {
    const readDate: Date = new Date(msg.readAt);
    md.appendMarkdown(`**Read:** ${String(readDate)}\n\n`);
  }

  md.appendMarkdown(`*ID: ${msg.id}*`);
  return md;
}
