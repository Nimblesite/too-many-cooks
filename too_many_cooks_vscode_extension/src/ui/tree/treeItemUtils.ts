// Utility functions for extracting typed data from tree items.

import type * as vscode from 'vscode';
import { collectDistinct, pickSelection } from '../treeSelection';
import { isRecord } from '../../services/httpClient';

function stringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value)) { return null; }
  const prop: unknown = value[key];
  return typeof prop === 'string' ? prop : null;
}

export function getFilePathFromItem(item?: vscode.TreeItem): string | null {
  if (typeof item === 'undefined') { return null; }
  // Duck-type checks to avoid instanceof failures across module boundaries.
  const direct: string | null = stringProperty(item, 'filePath');
  if (direct !== null) { return direct; }
  if ('lock' in item && typeof item.lock === 'object' && item.lock !== null) {
    return stringProperty(item.lock, 'filePath');
  }
  return null;
}

export function getAgentNameFromItem(item?: vscode.TreeItem): string | null {
  if (typeof item === 'undefined') { return null; }
  return stringProperty(item, 'agentName');
}

/** Collect distinct agent names from a clicked item plus multi-selection. */
export function collectAgentNames(
  item: vscode.TreeItem | undefined,
  selection: readonly vscode.TreeItem[] | undefined,
): readonly string[] {
  return collectDistinct(pickSelection(item, selection), getAgentNameFromItem);
}
