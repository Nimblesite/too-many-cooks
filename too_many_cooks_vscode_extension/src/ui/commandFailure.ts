// Shared failure reporting for command handlers: log once, tell the user once.

import type { DialogService } from '../services/dialogService';
import type { LogFn } from '../services/logging';

/** Everything needed to report a command failure. */
export interface FailureContext {
  readonly dialogs: Readonly<DialogService>;
  readonly logFn: LogFn;
}

/** Log `label` with the error and surface the identical message to the user. */
export async function reportFailure(
  context: Readonly<FailureContext>,
  label: string,
  err: unknown,
): Promise<void> {
  const message: string = `${label}: ${String(err)}`;
  context.logFn(message);
  await context.dialogs.showErrorMessage(message);
}

/** Run `action`, reporting any failure. Returns false when the action failed. */
export async function attemptOrReport(
  context: Readonly<FailureContext>,
  label: string,
  action: () => Promise<void>,
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (err: unknown) {
    await reportFailure(context, label, err);
    return false;
  }
}
