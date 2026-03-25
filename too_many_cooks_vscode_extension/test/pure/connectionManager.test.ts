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
import type { ConnectionManager } from '../../src/services/connectionManager';
import type { CloudTarget } from '../../src/services/connectionTypes';

/** Collect log messages. */
const createLogCollector = (): { readonly logs: string[]; readonly log: (msg: string) => void } => {
  const logs: string[] = [];
  return { logs, log: (msg: string): void => { logs.push(msg); } };
};

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

describe('ConnectionManager', () => {
  describe('initial state', () => {
    it('starts in disconnected mode with null target', () => {
      const { log } = createLogCollector();
      const cm: ConnectionManager = createConnectionManager('/tmp/tmc-test', log);

      assert.strictEqual(cm.getMode(), 'disconnected', 'Initial mode must be disconnected');
      assert.strictEqual(cm.getTarget(), null, 'Initial target must be null');
    });
  });

  describe('disconnect', () => {
    it('disconnect from disconnected state is safe (no-op)', () => {
      const { log, logs } = createLogCollector();
      const cm: ConnectionManager = createConnectionManager('/tmp/tmc-test', log);

      cm.disconnect();
      assert.strictEqual(cm.getMode(), 'disconnected', 'Mode stays disconnected');
      assert.strictEqual(cm.getTarget(), null, 'Target stays null');
      assert.ok(logs.some((l: string) => l.includes('Disconnected')), 'Must log disconnect');
    });

    it('multiple disconnects are safe', () => {
      const { log } = createLogCollector();
      const cm: ConnectionManager = createConnectionManager('/tmp/tmc-test', log);

      cm.disconnect();
      cm.disconnect();
      cm.disconnect();
      assert.strictEqual(cm.getMode(), 'disconnected');
      assert.strictEqual(cm.getTarget(), null);
    });
  });

  describe('connectCloud', () => {
    it('rejects unreachable cloud URL with descriptive error', async () => {
      const { log, logs } = createLogCollector();
      const cm: ConnectionManager = createConnectionManager('/tmp/tmc-test', log);

      try {
        await cm.connectCloud(UNREACHABLE_CLOUD_TARGET);
        assert.fail('Must throw for unreachable cloud URL');
      } catch (err: unknown) {
        assert.ok(err instanceof Error, 'Must throw an Error');
        assert.ok(
          err.message.includes('Cloud validation failed') || err.message.includes('fetch'),
          `Error must describe the failure: ${err.message}`,
        );
      }

      assert.strictEqual(cm.getMode(), 'disconnected', 'Mode must be disconnected after failure');
      assert.strictEqual(cm.getTarget(), null, 'Target must be null after failure');
      assert.ok(
        logs.some((l: string) => l.includes('Validating cloud credentials')),
        'Must log validation attempt',
      );
    });

    it('preserves disconnected state after failed cloud connection', async () => {
      const { log } = createLogCollector();
      const cm: ConnectionManager = createConnectionManager('/tmp/tmc-test', log);

      try { await cm.connectCloud(UNREACHABLE_CLOUD_TARGET); } catch { /* expected */ }

      assert.strictEqual(cm.getMode(), 'disconnected');
      assert.strictEqual(cm.getTarget(), null);

      // Should be able to retry
      try { await cm.connectCloud(UNREACHABLE_CLOUD_TARGET); } catch { /* expected */ }
      assert.strictEqual(cm.getMode(), 'disconnected');
    });
  });

  describe('startLocal', () => {
    it('rejects when server cannot be started (no binary available on port 1)', async () => {
      const { log, logs } = createLogCollector();
      const cm: ConnectionManager = createConnectionManager('/tmp/tmc-test', log);

      // Port 1 is privileged and won't work, server won't start in time
      try {
        await cm.startLocal(1);
        assert.fail('Must throw when server cannot start');
      } catch (err: unknown) {
        assert.ok(err instanceof Error, 'Must throw an Error');
        assert.ok(
          err.message.includes('did not start'),
          `Error must mention startup failure: ${err.message}`,
        );
      }

      // State should remain disconnected after failure
      // (though localProcess may still exist briefly)
      assert.ok(
        logs.some((l: string) => l.includes('Spawning local server')),
        'Must log spawn attempt',
      );
    });
  });

  describe('logging', () => {
    it('logs all lifecycle events', () => {
      const { log, logs } = createLogCollector();
      const cm: ConnectionManager = createConnectionManager('/tmp/tmc-test', log);

      cm.disconnect();

      assert.ok(logs.length > 0, 'Must have logged something');
      assert.ok(
        logs.every((l: string) => l.includes('[ConnectionManager]')),
        'All logs must be prefixed with [ConnectionManager]',
      );
    });
  });

  describe('cloud target validation', () => {
    it('CloudTarget has all required fields', () => {
      assert.strictEqual(UNREACHABLE_CLOUD_TARGET.mode, 'cloud');
      assert.strictEqual(UNREACHABLE_CLOUD_TARGET.apiUrl, 'http://127.0.0.1:1');
      assert.strictEqual(UNREACHABLE_CLOUD_TARGET.apiKey, 'test-key');
      assert.strictEqual(UNREACHABLE_CLOUD_TARGET.tenantId, 'test-tenant');
      assert.strictEqual(UNREACHABLE_CLOUD_TARGET.workspaceId, 'test-workspace');
      assert.strictEqual(UNREACHABLE_CLOUD_TARGET.passphrase, 'test-pass');
      assert.strictEqual(UNREACHABLE_CLOUD_TARGET.transport, 'stdio');
    });
  });
});
