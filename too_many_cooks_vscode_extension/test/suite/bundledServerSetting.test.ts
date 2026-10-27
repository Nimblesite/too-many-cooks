// [SWR-IDE-RESOLUTION] The tooManyCooks.serverPath setting overrides the
// bundled server — read through the real VS Code configuration API, exactly as
// the extension does — and the override is version-verified like the bundle.

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { LocalLaunchSpec } from '../../src/services/connectionManager';
import { isRecord } from '../../src/services/httpClient';
import { resolveServerLaunch } from '../../src/services/serverResolver';
import { shipwrightVscodeApi } from '../../src/services/shipwrightVscodeApi';

const EXTENSION_ROOT: string = path.resolve(__dirname, '..', '..', '..');
const EXE: string = process.platform === 'win32' ? 'too-many-cooks.exe' : 'too-many-cooks';
const BUNDLED_SERVER: string = path.join(EXTENSION_ROOT, 'bin', `${process.platform}-${process.arch}`, EXE);
const SECTION: string = 'tooManyCooks';
const SETTING: string = 'serverPath';
const SETTING_KEY: string = `${SECTION}.${SETTING}`;

/** Follow `keys` through nested records; null as soon as one is missing. */
function dig(value: unknown, keys: readonly string[]): unknown {
  return keys.reduce((node: unknown, key: string): unknown => (isRecord(node) ? node[key] : null), value);
}

suite('tooManyCooks.serverPath overrides the bundled server', () => {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'tmc-override-'));
  const override: string = path.join(dir, EXE);

  suiteSetup(async () => {
    fs.symlinkSync(BUNDLED_SERVER, override);
    await vscode.workspace.getConfiguration(SECTION).update(SETTING, override, vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    await vscode.workspace.getConfiguration(SECTION).update(SETTING, undefined, vscode.ConfigurationTarget.Global);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the setting is a machine-scoped string, so a workspace cannot point it at its own binary', () => {
    const inspected: unknown = vscode.workspace.getConfiguration(SECTION).inspect(SETTING);
    assert.ok(inspected !== undefined, 'tooManyCooks.serverPath must be a contributed setting');
    const ext: vscode.Extension<unknown> | undefined = vscode.extensions.all.find(
      (e: vscode.Extension<unknown>): boolean => e.extensionPath === EXTENSION_ROOT,
    );
    assert.ok(ext !== undefined, 'the extension under test is loaded');
    const setting: unknown = dig(ext.packageJSON, ['contributes', 'configuration', 'properties', SETTING_KEY]);
    assert.strictEqual(dig(setting, ['type']), 'string');
    assert.strictEqual(dig(setting, ['default']), '');
    assert.strictEqual(dig(setting, ['scope']), 'machine');
  });

  test('resolution launches the overriding binary after verifying its version', async () => {
    const spec: LocalLaunchSpec = await resolveServerLaunch(EXTENSION_ROOT, shipwrightVscodeApi);
    assert.strictEqual(spec.command, override);
    assert.deepStrictEqual(spec.args, []);
  });
});
