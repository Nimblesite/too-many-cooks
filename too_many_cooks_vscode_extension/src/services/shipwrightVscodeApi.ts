// Adapts the VS Code API (Thenable-returning) to the VscodeApiLike shape that
// @nimblesite/shipwright-vscode reads settings and shows its errors through.

import * as vscode from 'vscode';
import type { VscodeApiLike } from '@nimblesite/shipwright-vscode';

/** Modal options shipwright-vscode passes with every message. */
interface ModalOptions { readonly modal: boolean }

export const shipwrightVscodeApi: VscodeApiLike = {
  window: {
    showErrorMessage: async (message: string, options: ModalOptions, ...items: string[]): Promise<string | undefined> => {
      return await vscode.window.showErrorMessage(message, options, ...items);
    },
    showWarningMessage: async (message: string, options: ModalOptions, ...items: string[]): Promise<string | undefined> => {
      return await vscode.window.showWarningMessage(message, options, ...items);
    },
  },
  workspace: {
    getConfiguration: (section?: string): vscode.WorkspaceConfiguration => {
      return vscode.workspace.getConfiguration(section);
    },
  },
};
