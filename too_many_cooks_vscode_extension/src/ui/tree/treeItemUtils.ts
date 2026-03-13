// Utility functions for extracting typed data from tree items.

import type * as vscode from 'vscode';

function extractLockFilePath(lock: unknown): string | null {
  if (typeof lock === 'object' && lock !== null && 'filePath' in lock && typeof lock.filePath === 'string') {
    return lock.filePath;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
export function getFilePathFromItem(item?: vscode.TreeItem): string | null {
  if (typeof item === 'undefined') { return null; }
  // Duck-type checks to avoid instanceof failures across module boundaries.
  if ('filePath' in item && typeof item.filePath === 'string') {
    return item.filePath;
  }
  if ('lock' in item && typeof item.lock === 'object' && item.lock !== null) {
    return extractLockFilePath(item.lock);
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
export function getAgentNameFromItem(item?: vscode.TreeItem): string | null {
  if (typeof item === 'undefined') { return null; }
  if ('agentName' in item && typeof item.agentName === 'string') {
    return item.agentName;
  }
  return null;
}
