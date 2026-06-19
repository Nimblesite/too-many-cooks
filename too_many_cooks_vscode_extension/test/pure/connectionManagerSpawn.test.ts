/// ConnectionManager local-server launch + spawn-failure tests — Issue #17 / ENOENT fix.
///
/// The VSIX "Start Local Server" command must work on a clean machine with no
/// global `too-many-cooks` install. It therefore launches the server via
/// `npx -y too-many-cooks@latest` (always the latest published build) rather
/// than spawning a bare `too-many-cooks` binary that only exists when installed
/// globally — the bare spawn produced `spawn too-many-cooks ENOENT`.
///
/// On Windows `npx` resolves to a `npx.cmd` shim that Node's spawn() can only
/// run via the shell; without it spawn() fails with ENOENT. These tests also
/// prove a genuine spawn failure is surfaced promptly with a descriptive error
/// instead of being swallowed and masked by the generic startup timeout.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildLocalLaunchSpec, buildLocalSpawnConfig, createConnectionManager } from '../../src/services/connectionManager';
import type { ConnectionManager, LocalLaunchSpec } from '../../src/services/connectionManager';

const NONEXISTENT_BIN: string = '/nonexistent/tmc-server-does-not-exist-zzz';
const NONEXISTENT_LAUNCH: LocalLaunchSpec = { args: [], command: NONEXISTENT_BIN };
const TEST_PORT: number = 4099;
const GENERIC_TIMEOUT_FRAGMENT: string = 'did not start within';
const EXPECTED_PACKAGE: string = 'too-many-cooks@latest';

const createLogCollector = (): { readonly logs: string[]; readonly log: (msg: string) => void } => {
  const logs: string[] = [];
  return { logs, log: (msg: string): void => { logs.push(msg); } };
};

describe('ConnectionManager local server launch (ENOENT fix)', () => {
  it('launches via `npx` pinned to the latest published package so no global install is needed', () => {
    const spec: LocalLaunchSpec = buildLocalLaunchSpec();

    assert.strictEqual(
      spec.command,
      'npx',
      `must launch via npx (not a bare binary) so a clean machine has no spawn ENOENT — got "${spec.command}"`,
    );
    assert.ok(
      spec.args.includes(EXPECTED_PACKAGE),
      `must run the latest published server every time — args were: ${spec.args.join(' ')}`,
    );
    assert.ok(
      spec.args.includes('-y'),
      `must pass -y so npx auto-installs without an interactive prompt — args were: ${spec.args.join(' ')}`,
    );
  });
});

describe('ConnectionManager local server spawn failure (#17)', () => {
  it('surfaces a descriptive spawn error instead of swallowing it and timing out', async () => {
    const { log, logs } = createLogCollector();
    const cm: ConnectionManager = createConnectionManager('/tmp/tmc-test', log, NONEXISTENT_LAUNCH);

    await assert.rejects(
      cm.startLocal(TEST_PORT),
      (err: unknown): boolean => {
        assert.ok(err instanceof Error, 'must reject with an Error');
        assert.ok(
          !err.message.includes(GENERIC_TIMEOUT_FRAGMENT),
          `spawn failure must not be masked by the generic startup timeout: ${err.message}`,
        );
        assert.ok(
          err.message.includes(NONEXISTENT_BIN) || /ENOENT|could not be started/i.test(err.message),
          `error must describe the spawn failure: ${err.message}`,
        );
        return true;
      },
    );

    assert.ok(
      logs.some((l: string) => l.includes('Spawning local server')),
      'must log the spawn attempt',
    );
  });

  it('uses the shell on Windows so the npx.cmd shim resolves, but not on posix', () => {
    assert.strictEqual(buildLocalSpawnConfig('win32').shell, true, 'Windows must spawn via shell to find the .cmd shim');
    assert.strictEqual(buildLocalSpawnConfig('darwin').shell, false, 'macOS does not need the shell');
    assert.strictEqual(buildLocalSpawnConfig('linux').shell, false, 'Linux does not need the shell');
  });
});
