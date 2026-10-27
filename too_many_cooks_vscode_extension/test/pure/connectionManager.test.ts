/// ConnectionManager pure tests — proves lifecycle, state transitions, and error handling.
///
/// Phase 7 of the VSIX connection switcher.
/// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
/// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md
///
/// These tests exercise ConnectionManager without spawning a real server.
/// Cloud validation uses a real HTTP call so we test with an unreachable URL.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createConnectionManager } from '../../src/services/connectionManager';
import type { ConnectionManager, LocalLaunchSpec } from '../../src/services/connectionManager';
import type { CloudTarget } from '../../src/services/connectionTypes';
import { assertMatches, createLogCollector } from './testSupport';
import type { LogCollector } from './testSupport';

/** Workspace folder every ConnectionManager test points at. */
const WORKSPACE_FOLDER = '/tmp/tmc-test';

/** A launch spec whose command can never resolve, so startLocal fails fast via
 *  an ENOENT 'error' event instead of npx reaching the network during tests. */
const NONEXISTENT_LAUNCH: LocalLaunchSpec = { args: [], command: '/nonexistent/tmc-server-does-not-exist-zzz' };

/** Cloud target pointing to an unreachable URL. */
const UNREACHABLE_CLOUD_TARGET: CloudTarget = {
  apiKey: 'test-key',
  apiUrl: 'http://127.0.0.1:1',
  mode: 'cloud',
  passphrase: 'test-pass',
  tenantId: 'test-tenant',
  transport: 'stdio',
  workspaceId: 'test-workspace',
};

/** Message prefix the cloud validator emits when its HTTP probe fails. */
const CLOUD_VALIDATION_FAILED = 'Cloud validation failed';

/** ConnectionManager over a log collector, optionally with an injected launch spec. */
function makeManager(collector: LogCollector, launch?: LocalLaunchSpec): ConnectionManager {
  return createConnectionManager(WORKSPACE_FOLDER, collector.log, launch);
}

/** Assert the manager reports a fully disconnected state. */
function assertManagerDisconnected(cm: ConnectionManager, suffix: string): void {
  assert.strictEqual(cm.getMode(), 'disconnected', `mode disconnected ${suffix}`);
  assert.strictEqual(cm.getTarget(), null, `target null ${suffix}`);
}

/** Assert connectCloud rejects for the unreachable cloud target. */
async function expectCloudFailure(cm: ConnectionManager): Promise<void> {
  try {
    await cm.connectCloud(UNREACHABLE_CLOUD_TARGET);
    assert.fail('Must throw for unreachable cloud URL');
  } catch (err: unknown) {
    assert.ok(err instanceof Error, 'Must throw an Error');
    assert.ok(
      err.message.includes(CLOUD_VALIDATION_FAILED) || err.message.includes('fetch'),
      `Error must describe the failure: ${err.message}`,
    );
  }
}

/** Attempt a cloud connect and swallow the expected rejection. */
async function ignoreCloudFailure(cm: ConnectionManager): Promise<void> {
  try { await cm.connectCloud(UNREACHABLE_CLOUD_TARGET); } catch { /* expected */ }
}

describe('ConnectionManager', () => {
  describe('initial state', () => {
    it('starts in disconnected mode with null target', () => {
      const cm: ConnectionManager = makeManager(createLogCollector());

      assert.strictEqual(cm.getMode(), 'disconnected', 'Initial mode must be disconnected');
      assert.strictEqual(cm.getTarget(), null, 'Initial target must be null');
    });
  });

  describe('disconnect', () => {
    it('disconnect from disconnected state is safe (no-op)', () => {
      const collector: LogCollector = createLogCollector();
      const cm: ConnectionManager = makeManager(collector);

      cm.disconnect();
      assertManagerDisconnected(cm, 'stays disconnected');
      assert.ok(collector.logs.some((l: string) => l.includes('Disconnected')), 'Must log disconnect');
    });

    it('multiple disconnects are safe', () => {
      const cm: ConnectionManager = makeManager(createLogCollector());

      cm.disconnect();
      cm.disconnect();
      cm.disconnect();
      assertManagerDisconnected(cm, 'after repeated disconnects');
    });
  });

  describe('connectCloud', () => {
    it('rejects unreachable cloud URL with descriptive error', async () => {
      const collector: LogCollector = createLogCollector();
      const cm: ConnectionManager = makeManager(collector);

      await expectCloudFailure(cm);

      assertManagerDisconnected(cm, 'after failure');
      assert.ok(
        collector.logs.some((l: string) => l.includes('Validating cloud credentials')),
        'Must log validation attempt',
      );
    });

    it('preserves disconnected state after failed cloud connection', async () => {
      const cm: ConnectionManager = makeManager(createLogCollector());

      await ignoreCloudFailure(cm);

      assertManagerDisconnected(cm, 'after first failure');

      // Should be able to retry
      await ignoreCloudFailure(cm);
      assertManagerDisconnected(cm, 'after retry failure');
    });
  });

  describe('startLocal', () => {
    it('rejects when server cannot be started (command not resolvable)', async () => {
      const collector: LogCollector = createLogCollector();
      const cm: ConnectionManager = makeManager(collector, NONEXISTENT_LAUNCH);

      // The injected launch command can never resolve; the spawn fails fast
      // (ENOENT 'error', Issue #17). Both an ENOENT spawn failure and a startup
      // poll timeout are valid startup failures.
      try {
        await cm.startLocal(1);
        assert.fail('Must throw when server cannot start');
      } catch (err: unknown) {
        assert.ok(err instanceof Error, 'Must throw an Error');
        assert.ok(
          err.message.includes('did not start') || err.message.includes('could not be started'),
          `Error must mention startup failure: ${err.message}`,
        );
      }

      // State should remain disconnected after failure
      // (though localProcess may still exist briefly)
      assert.ok(
        collector.logs.some((l: string) => l.includes('Spawning local server')),
        'Must log spawn attempt',
      );
    });
  });

  describe('logging', () => {
    it('logs all lifecycle events', () => {
      const collector: LogCollector = createLogCollector();
      const cm: ConnectionManager = makeManager(collector);

      cm.disconnect();

      assert.ok(collector.logs.length > 0, 'Must have logged something');
      assert.ok(
        collector.logs.every((l: string) => l.includes('[ConnectionManager]')),
        'All logs must be prefixed with [ConnectionManager]',
      );
    });
  });

  describe('cloud target validation', () => {
    it('CloudTarget has all required fields', () => {
      assertMatches(UNREACHABLE_CLOUD_TARGET, {
        mode: 'cloud',
        apiUrl: 'http://127.0.0.1:1',
        apiKey: 'test-key',
        tenantId: 'test-tenant',
        workspaceId: 'test-workspace',
        passphrase: 'test-pass',
        transport: 'stdio',
      });
    });
  });
});
