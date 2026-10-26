/// ConnectionManager local-server launch + spawn-failure tests — Issue #17 / ENOENT fix.
///
/// The VSIX "Start Local Server" command must work on a clean machine with no
/// global `too-many-cooks` install. It launches the server binary bundled in
/// the VSIX ([SWR-IDE-RESOLUTION], serverResolver.ts) — never npx, a global
/// install or a PATH lookup, all of which failed with `spawn ... ENOENT` or
/// pulled an unverified version. The binary is a real executable (an .exe on
/// Windows), so no platform spawns through a shell. These tests also prove a
/// genuine spawn failure is surfaced promptly with a descriptive error instead
/// of being swallowed and masked by the generic startup timeout.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildLocalSpawnConfig, createConnectionManager } from '../../src/services/connectionManager';
import type { ConnectionManager, LocalLaunchSpec } from '../../src/services/connectionManager';
import { createLogCollector } from './testSupport';

const NONEXISTENT_BIN: string = '/nonexistent/tmc-server-does-not-exist-zzz';
const NONEXISTENT_LAUNCH: LocalLaunchSpec = { args: [], command: NONEXISTENT_BIN };
const TEST_PORT: number = 4099;
const GENERIC_TIMEOUT_FRAGMENT: string = 'did not start within';

describe('ConnectionManager local server launch (ENOENT fix)', () => {
  it('spawns exactly the binary the resolver returns — never npx', async () => {
    const { log, logs } = createLogCollector();
    const resolved: string[] = [];
    const cm: ConnectionManager = createConnectionManager('/tmp/tmc-test', log, async (): Promise<LocalLaunchSpec> => {
      resolved.push(NONEXISTENT_BIN);
      return await Promise.resolve(NONEXISTENT_LAUNCH);
    });

    await assert.rejects(cm.startLocal(TEST_PORT));

    assert.deepStrictEqual(resolved, [NONEXISTENT_BIN], 'the launch is resolved once per start');
    assert.ok(
      logs.some((l: string) => l.includes(`Spawning local server '${NONEXISTENT_BIN}`)),
      `must spawn the resolved binary itself — logs: ${logs.join(' | ')}`,
    );
    assert.ok(!logs.some((l: string) => l.includes('npx')), 'must never launch through npx');
  });

  it('refuses to start without a resolved launch instead of guessing a binary', async () => {
    const { log, logs } = createLogCollector();
    const cm: ConnectionManager = createConnectionManager('/tmp/tmc-test', log);

    await assert.rejects(cm.startLocal(TEST_PORT), /No local server launch is configured/u);
    assert.ok(!logs.some((l: string) => l.includes('Spawning local server')), 'nothing is spawned');
    assert.strictEqual(cm.getMode(), 'disconnected');
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
          err.message.includes(NONEXISTENT_BIN) || /ENOENT|could not be started/iu.test(err.message),
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

  it('never spawns through a shell, so an extension path with spaces launches on every platform', () => {
    assert.strictEqual(buildLocalSpawnConfig('win32').shell, false, 'Windows runs the bundled .exe directly');
    assert.strictEqual(buildLocalSpawnConfig('darwin').shell, false, 'macOS does not need the shell');
    assert.strictEqual(buildLocalSpawnConfig('linux').shell, false, 'Linux does not need the shell');
  });
});
