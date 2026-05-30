/// ConnectionManager local-server spawn-failure tests — Issue #17.
///
/// On Windows the global npm bin is a `.cmd` shim that Node's spawn() can only
/// resolve via the shell; without it spawn() fails with ENOENT. Previously the
/// 'error' event was never handled, so the failure was swallowed and the user
/// only ever saw the misleading generic "did not start within 15000ms" timeout.
///
/// These tests inject a guaranteed-nonexistent binary to prove the spawn
/// failure is surfaced promptly with a descriptive error, and that the spawn
/// is configured to use the shell on Windows so the `.cmd` shim resolves.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildLocalSpawnConfig, createConnectionManager } from '../../src/services/connectionManager';
import type { ConnectionManager } from '../../src/services/connectionManager';

const NONEXISTENT_BIN: string = '/nonexistent/tmc-server-does-not-exist-zzz';
const TEST_PORT: number = 4099;
const GENERIC_TIMEOUT_FRAGMENT: string = 'did not start within';

const createLogCollector = (): { readonly logs: string[]; readonly log: (msg: string) => void } => {
  const logs: string[] = [];
  return { logs, log: (msg: string): void => { logs.push(msg); } };
};

describe('ConnectionManager local server spawn failure (#17)', () => {
  it('surfaces a descriptive spawn error instead of swallowing it and timing out', async () => {
    const { log, logs } = createLogCollector();
    const cm: ConnectionManager = createConnectionManager('/tmp/tmc-test', log, NONEXISTENT_BIN);

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

  it('uses the shell on Windows so the .cmd shim resolves, but not on posix', () => {
    assert.strictEqual(buildLocalSpawnConfig('win32').shell, true, 'Windows must spawn via shell to find the .cmd shim');
    assert.strictEqual(buildLocalSpawnConfig('darwin').shell, false, 'macOS does not need the shell');
    assert.strictEqual(buildLocalSpawnConfig('linux').shell, false, 'Linux does not need the shell');
  });
});
