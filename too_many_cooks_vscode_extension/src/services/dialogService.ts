// Dialog service - abstraction over vscode.window dialogs for testability.

import * as vscode from 'vscode';

/** Subset of vscode.InputBoxOptions the extension uses, with readonly fields. */
export interface DialogInputOptions {
  readonly placeHolder?: string;
  readonly prompt?: string;
}

/** Subset of vscode.MessageOptions the extension uses, with readonly fields. */
export interface DialogMessageOptions {
  readonly modal?: boolean;
}

export interface DialogService {
  readonly showErrorMessage: (message: string) => Thenable<string | undefined>;
  readonly showInformationMessage: (message: string) => Thenable<string | undefined>;
  readonly showInputBox: (options: Readonly<DialogInputOptions>) => Thenable<string | undefined>;
   
  readonly showQuickPick: (items: readonly string[], options: Readonly<vscode.QuickPickOptions>) => Thenable<string | undefined>;
  readonly showWarningMessage: (
    message: string,
    options: Readonly<DialogMessageOptions>,
    ...items: readonly string[]
  ) => Thenable<string | undefined>;
}

function toInputBoxOptions(options: Readonly<DialogInputOptions>): vscode.InputBoxOptions {
  const inputOptions: vscode.InputBoxOptions = {};
  if (typeof options.placeHolder !== 'undefined') {
    inputOptions.placeHolder = options.placeHolder;
  }
  if (typeof options.prompt !== 'undefined') {
    inputOptions.prompt = options.prompt;
  }
  return inputOptions;
}

function createDefaultDialogService(): DialogService {
  return {
    showErrorMessage: (message: string): Thenable<string | undefined> => {
      return vscode.window.showErrorMessage(message);
    },
    showInformationMessage: (message: string): Thenable<string | undefined> => {
      return vscode.window.showInformationMessage(message);
    },
    showInputBox: (options: Readonly<DialogInputOptions>): Thenable<string | undefined> => {
      return vscode.window.showInputBox(toInputBoxOptions(options));
    },
    showQuickPick: (items: readonly string[], options: Readonly<vscode.QuickPickOptions>): Thenable<string | undefined> => {
      return vscode.window.showQuickPick([...items], options);
    },
    showWarningMessage: (
      message: string,
      options: Readonly<DialogMessageOptions>,
      ...items: readonly string[]
    ): Thenable<string | undefined> => {
      return vscode.window.showWarningMessage(
        message,
        { modal: options.modal ?? false },
        ...items,
      );
    },
  };
}

let activeDialogService: DialogService = createDefaultDialogService();

export function getDialogService(): DialogService {
  return activeDialogService;
}

export function setDialogService(service: Readonly<DialogService>): void {
  activeDialogService = service;
}

export function resetDialogService(): void {
  activeDialogService = createDefaultDialogService();
}
