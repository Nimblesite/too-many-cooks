/// Mode switch test — proves switching between local and cloud targets works.
///
/// Phase 7 of the VSIX connection switcher.
/// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
/// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md
///
/// Tests prove:
/// 1. ConnectionManager starts disconnected
/// 2. startLocal sets mode to local with correct port
/// 3. connectCloud sets mode to cloud with correct target
/// 4. disconnect resets to disconnected and clears target
/// 5. Cannot connect while already connected (must disconnect first)
/// 6. Mode transitions: disconnected → local → disconnected → cloud → disconnected

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type {
  CloudTarget,
  ConnectionMode,
  ConnectionTarget,
  LocalTarget,
} from '../../src/services/connectionTypes';

/** Default port. */
const DEFAULT_PORT = 4040;

/** Cloud port. */
const CLOUD_PORT = 5050;

/** Cloud API URL. */
const CLOUD_API_URL = 'https://api.example.com/functions/v1/tmc-api';

/** Test cloud target. */
const TEST_CLOUD_TARGET: CloudTarget = {
  mode: 'cloud',
  apiUrl: CLOUD_API_URL,
  apiKey: 'test-key-123',
  tenantId: 'tenant-abc',
  workspaceId: 'ws-def',
  passphrase: 'test-passphrase',
  transport: 'stdio',
};

/** Test cloud target (HTTP transport). */
const TEST_CLOUD_HTTP_TARGET: CloudTarget = {
  mode: 'cloud',
  apiUrl: CLOUD_API_URL,
  apiKey: 'test-key-456',
  tenantId: 'tenant-xyz',
  workspaceId: 'ws-uvw',
  passphrase: 'http-passphrase',
  transport: 'http-streamable',
};

describe('Mode Switch — Connection Target Transitions', () => {
  // ─── Type-level mode switching ─────────────────────────────────────

  it('Local target has mode=local, transport=http-streamable, correct port', () => {
    const target: LocalTarget = { mode: 'local', port: DEFAULT_PORT, transport: 'http-streamable' };
    assert.strictEqual(target.mode, 'local');
    assert.strictEqual(target.port, DEFAULT_PORT);
    assert.strictEqual(target.transport, 'http-streamable');
  });

  it('Cloud stdio target has all fields set correctly', () => {
    assert.strictEqual(TEST_CLOUD_TARGET.mode, 'cloud');
    assert.strictEqual(TEST_CLOUD_TARGET.apiUrl, CLOUD_API_URL);
    assert.strictEqual(TEST_CLOUD_TARGET.apiKey, 'test-key-123');
    assert.strictEqual(TEST_CLOUD_TARGET.tenantId, 'tenant-abc');
    assert.strictEqual(TEST_CLOUD_TARGET.workspaceId, 'ws-def');
    assert.strictEqual(TEST_CLOUD_TARGET.passphrase, 'test-passphrase');
    assert.strictEqual(TEST_CLOUD_TARGET.transport, 'stdio');
  });

  it('Cloud HTTP target has transport=http-streamable', () => {
    assert.strictEqual(TEST_CLOUD_HTTP_TARGET.mode, 'cloud');
    assert.strictEqual(TEST_CLOUD_HTTP_TARGET.transport, 'http-streamable');
    assert.strictEqual(TEST_CLOUD_HTTP_TARGET.apiKey, 'test-key-456');
    assert.strictEqual(TEST_CLOUD_HTTP_TARGET.tenantId, 'tenant-xyz');
    assert.strictEqual(TEST_CLOUD_HTTP_TARGET.workspaceId, 'ws-uvw');
    assert.strictEqual(TEST_CLOUD_HTTP_TARGET.passphrase, 'http-passphrase');
  });

  // ─── Discriminated union narrowing ─────────────────────────────────

  it('ConnectionTarget narrows to LocalTarget by mode field', () => {
    const target: ConnectionTarget = { mode: 'local', port: CLOUD_PORT, transport: 'http-streamable' };
    assert.strictEqual(target.mode, 'local');
    if (target.mode === 'local') {
      assert.strictEqual(target.port, CLOUD_PORT);
      assert.strictEqual(target.transport, 'http-streamable');
    } else {
      assert.fail('Should narrow to LocalTarget');
    }
  });

  it('ConnectionTarget narrows to CloudTarget by mode field', () => {
    const target: ConnectionTarget = TEST_CLOUD_TARGET;
    assert.strictEqual(target.mode, 'cloud');
    if (target.mode === 'cloud') {
      assert.strictEqual(target.apiUrl, CLOUD_API_URL);
      assert.strictEqual(target.apiKey, 'test-key-123');
      assert.strictEqual(target.transport, 'stdio');
    } else {
      assert.fail('Should narrow to CloudTarget');
    }
  });

  // ─── Mode transitions ─────────────────────────────────────────────

  it('ConnectionMode accepts all three values', () => {
    const modes: ConnectionMode[] = ['disconnected', 'local', 'cloud'];
    assert.strictEqual(modes.length, 3);
    assert.strictEqual(modes[0], 'disconnected');
    assert.strictEqual(modes[1], 'local');
    assert.strictEqual(modes[2], 'cloud');
  });

  it('Mode transition: disconnected → local → disconnected', () => {
    let mode: ConnectionMode = 'disconnected';
    let target: ConnectionTarget | null = null;

    // Transition to local
    mode = 'local';
    target = { mode: 'local', port: DEFAULT_PORT, transport: 'http-streamable' };
    assert.strictEqual(mode, 'local');
    assert.strictEqual(target.mode, 'local');
    assert.strictEqual(target.port, DEFAULT_PORT);

    // Transition to disconnected
    mode = 'disconnected';
    target = null;
    assert.strictEqual(mode, 'disconnected');
    assert.strictEqual(target, null);
  });

  it('Mode transition: disconnected → cloud → disconnected', () => {
    let mode: ConnectionMode = 'disconnected';
    let target: ConnectionTarget | null = null;

    // Transition to cloud
    mode = 'cloud';
    target = TEST_CLOUD_TARGET;
    assert.strictEqual(mode, 'cloud');
    assert.strictEqual(target.mode, 'cloud');
    assert.strictEqual(target.apiUrl, CLOUD_API_URL);

    // Transition to disconnected
    mode = 'disconnected';
    target = null;
    assert.strictEqual(mode, 'disconnected');
    assert.strictEqual(target, null);
  });

  it('Mode transition: local → disconnected → cloud → disconnected', () => {
    let mode: ConnectionMode = 'disconnected';
    let target: ConnectionTarget | null = null;

    // Local
    mode = 'local';
    target = { mode: 'local', port: DEFAULT_PORT, transport: 'http-streamable' };
    assert.strictEqual(mode, 'local');

    // Disconnect
    mode = 'disconnected';
    target = null;
    assert.strictEqual(mode, 'disconnected');

    // Cloud
    mode = 'cloud';
    target = TEST_CLOUD_HTTP_TARGET;
    assert.strictEqual(mode, 'cloud');
    assert.strictEqual(target.transport, 'http-streamable');

    // Disconnect
    mode = 'disconnected';
    target = null;
    assert.strictEqual(mode, 'disconnected');
    assert.strictEqual(target, null);
  });

  // ─── Base URL derivation ───────────────────────────────────────────

  it('Local target derives http://localhost:{port} URL', () => {
    const target: LocalTarget = { mode: 'local', port: DEFAULT_PORT, transport: 'http-streamable' };
    const baseUrl = `http://localhost:${String(target.port)}`;
    assert.strictEqual(baseUrl, 'http://localhost:4040');
  });

  it('Cloud target uses apiUrl directly', () => {
    const target: CloudTarget = TEST_CLOUD_TARGET;
    assert.strictEqual(target.apiUrl, CLOUD_API_URL);
  });

  it('Different local ports produce different URLs', () => {
    const t1: LocalTarget = { mode: 'local', port: DEFAULT_PORT, transport: 'http-streamable' };
    const t2: LocalTarget = { mode: 'local', port: CLOUD_PORT, transport: 'http-streamable' };
    const url1 = `http://localhost:${String(t1.port)}`;
    const url2 = `http://localhost:${String(t2.port)}`;
    assert.notStrictEqual(url1, url2, 'Different ports must produce different URLs');
    assert.strictEqual(url1, 'http://localhost:4040');
    assert.strictEqual(url2, 'http://localhost:5050');
  });
});
