/// [SWR-IDE-RESOLUTION] [SWR-VERSION-MATCHING] The VSIX launches the server
/// binary bundled under bin/<target>/ (or an explicit TMC_SERVER_PATH /
/// tooManyCooks.serverPath override), never npx / a global install / PATH, and
/// only when its `--version` matches the version in the shipped shipwright.json.
/// Each test builds a throwaway extension root with a real manifest and a
/// stand-in executable that answers `--version` like the real server. The
/// settings override is exercised against real VS Code in the E2E suite.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LocalLaunchSpec } from '../../src/services/connectionManager';
import { resolveServerLaunch } from '../../src/services/serverResolver';

const MANIFEST_VERSION: string = '4.5.6';
const WRONG_VERSION: string = '9.9.9';
const TARGET: string = `${process.platform}-${process.arch}`;
const BINARY: string = 'too-many-cooks';
const PLATFORMS: readonly string[] = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'];

/** The bundled-server half of the real shipwright.json, at MANIFEST_VERSION. */
const MANIFEST: Readonly<Record<string, unknown>> = {
  components: [{
    binaryName: BINARY,
    bundled: { bundlePath: 'bin/${platform}/${binaryName}${exe}', checksum: false, perPlatformArtifact: true },
    env: { pathVar: 'TMC_SERVER_PATH' },
    expectedVersion: '${PRODUCT_VERSION}',
    id: BINARY,
    kind: 'mcp',
    platforms: PLATFORMS,
    sources: ['user-setting', 'env', 'bundled'],
    userSetting: 'tooManyCooks.serverPath',
    versionCheckStrategy: 'version-flag',
  }],
  hosts: { vscode: { activationVerifies: [BINARY], artifact: 'vsix-per-platform', onMismatch: 'error' } },
  manifestVersion: 1,
  product: { id: BINARY, version: MANIFEST_VERSION },
};

const ENV_OVERRIDE: string = 'TMC_SERVER_PATH';

/** A stand-in server executable that prints `too-many-cooks <version>`. */
function writeServer(path: string, version: string): void {
  writeFileSync(path, `#!/bin/sh\necho "${BINARY} ${version}"\n`);
  chmodSync(path, 0o755);
}

describe('resolveServerLaunch (bundled server, version-verified)', () => {
  const root: string = mkdtempSync(join(tmpdir(), 'tmc-resolver-'));
  const bundled: string = join(root, 'bin', TARGET, BINARY);
  const override: string = join(root, 'override-server');

  before(() => {
    mkdirSync(join(root, 'bin', TARGET), { recursive: true });
    writeFileSync(join(root, 'shipwright.json'), JSON.stringify(MANIFEST));
  });

  after(() => { rmSync(root, { recursive: true, force: true }); });

  it('refuses to start when no server is bundled, telling the user to reinstall', async () => {
    await assert.rejects(resolveServerLaunch(root), (err: unknown): boolean => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /cannot start/u);
      assert.ok(err.message.includes(MANIFEST_VERSION), err.message);
      return true;
    });
  });

  it('launches the binary bundled for this platform when its version matches', async () => {
    writeServer(bundled, MANIFEST_VERSION);
    const spec: LocalLaunchSpec = await resolveServerLaunch(root);
    assert.strictEqual(spec.command, bundled);
    assert.deepStrictEqual(spec.args, []);
    assert.ok(!spec.command.includes('npx'), 'never npx');
  });

  it('refuses a bundled binary whose --version does not match the extension', async () => {
    writeServer(bundled, WRONG_VERSION);
    await assert.rejects(resolveServerLaunch(root), (err: unknown): boolean => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /version mismatch/u);
      assert.ok(err.message.includes(`Expected ${MANIFEST_VERSION}`), err.message);
      assert.ok(err.message.includes(`found ${WRONG_VERSION}`), err.message);
      return true;
    });
    writeServer(bundled, MANIFEST_VERSION);
  });

  it('prefers a TMC_SERVER_PATH override over the bundled binary', async () => {
    writeServer(override, MANIFEST_VERSION);
    process.env[ENV_OVERRIDE] = override;
    try {
      const spec: LocalLaunchSpec = await resolveServerLaunch(root);
      assert.strictEqual(spec.command, override);
      assert.deepStrictEqual(spec.args, []);
    } finally {
      Reflect.deleteProperty(process.env, ENV_OVERRIDE);
    }
  });

  it('still version-checks an overridden binary', async () => {
    writeServer(override, WRONG_VERSION);
    process.env[ENV_OVERRIDE] = override;
    try {
      await assert.rejects(resolveServerLaunch(root), /version mismatch/u);
    } finally {
      Reflect.deleteProperty(process.env, ENV_OVERRIDE);
    }
  });

  it('fails clearly when the extension ships no shipwright.json', async () => {
    const empty: string = mkdtempSync(join(tmpdir(), 'tmc-resolver-empty-'));
    await assert.rejects(resolveServerLaunch(empty), /ENOENT|shipwright\.json/u);
    rmSync(empty, { recursive: true, force: true });
  });
});
