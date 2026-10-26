// [SWR-IDE-RESOLUTION] Resolve the local server binary the VSIX launches.
// Order: the tooManyCooks.serverPath setting, then TMC_SERVER_PATH, then the
// Binary bundled under bin/<target>/ (shipwright.json). Never npx, a global
// Install or a PATH lookup. The chosen binary's `--version` must match the
// Extension's version, or startup stops with Shipwright's error
// ([SWR-VERSION-MATCHING]).

import type { ActivationDiagnostic, ActivationResult, VscodeApiLike } from '@nimblesite/shipwright-vscode';
import type { LocalLaunchSpec } from './connectionManager';
import { activateShipwright } from '@nimblesite/shipwright-vscode';

/** Shipwright.json component id of the server (also its `--version` name). */
export const SERVER_COMPONENT_ID: string = 'too-many-cooks';

/** Message when the manifest has no verdict for the server at all. */
const NO_DIAGNOSTIC: string = 'shipwright.json does not verify the too-many-cooks server';

/** Resolution never consults PATH: only the manifest's declared sources. */
const NO_PATH_ENTRIES: string[] = [];

/** True for the server's diagnostic. */
function isServerDiagnostic(diagnostic: ActivationDiagnostic): boolean {
  return diagnostic.componentId === SERVER_COMPONENT_ID;
}

/** Resolve and verify the server binary, or throw the user-facing reason. */
export async function resolveServerLaunch(extensionPath: string, vscodeApi?: VscodeApiLike): Promise<LocalLaunchSpec> {
  const result: ActivationResult = await activateShipwright(
    { extensionPath },
    vscodeApi ? { pathEntries: NO_PATH_ENTRIES, vscode: vscodeApi } : { pathEntries: NO_PATH_ENTRIES },
  );
  const server: ActivationDiagnostic | undefined = result.diagnostics.find(isServerDiagnostic);
  const binary: string | null | undefined = server?.resolution.path;
  if (server?.blocking !== false || typeof binary !== 'string') { throw new Error(server?.message ?? NO_DIAGNOSTIC); }
  return { args: [], command: binary };
}
