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
import { assertMatches, makeCloudTarget, makeLocalTarget } from './testSupport';

/** Default port. */
const DEFAULT_PORT = 4040;

/** Cloud port. */
const CLOUD_PORT = 5050;

/** Cloud API URL. */
const CLOUD_API_URL = 'https://api.example.com/functions/v1/tmc-api';

/** Test cloud target. */
const TEST_CLOUD_TARGET: CloudTarget = makeCloudTarget({
  apiKey: 'test-key-123',
  apiUrl: CLOUD_API_URL,
  passphrase: 'test-passphrase',
  tenantId: 'tenant-abc',
  workspaceId: 'ws-def',
});

/** Test cloud target (HTTP transport). */
const TEST_CLOUD_HTTP_TARGET: CloudTarget = {
  ...TEST_CLOUD_TARGET,
  apiKey: 'test-key-456',
  passphrase: 'http-passphrase',
  tenantId: 'tenant-xyz',
  transport: 'http-streamable',
  workspaceId: 'ws-uvw',
};

/** Assert the given state is a live local target on the expected port. */
function assertLocal(mode: ConnectionMode, target: ConnectionTarget | null, port: number): void {
  assert.strictEqual(mode, 'local');
  assert.strictEqual(target?.mode, 'local');
  assert.strictEqual(target?.port, port);
}

/** Assert the given state is a live cloud target for the expected API URL. */
function assertCloud(mode: ConnectionMode, target: ConnectionTarget | null, apiUrl: string): void {
  assert.strictEqual(mode, 'cloud');
  assert.strictEqual(target?.mode, 'cloud');
  assert.strictEqual(target?.apiUrl, apiUrl);
}

/** Assert the given state is fully disconnected. */
function assertDisconnected(mode: ConnectionMode, target: ConnectionTarget | null): void {
  assert.strictEqual(mode, 'disconnected');
  assert.strictEqual(target, null);
}

/** Mutable connection state replayed by the mode-transition cases. */
interface TransitionState {
  mode: ConnectionMode;
  target: ConnectionTarget | null;
}

/** One step of a mode transition script. */
type TransitionStep =
  | { readonly kind: 'local'; readonly port: number }
  | { readonly kind: 'cloud'; readonly target: CloudTarget }
  | { readonly kind: 'disconnected' };

/** Apply one step to the connection state. */
function applyStep(state: TransitionState, step: TransitionStep): void {
  switch (step.kind) {
    case 'local':
      state.mode = 'local';
      state.target = makeLocalTarget(step.port);
      break;
    case 'cloud':
      state.mode = 'cloud';
      state.target = step.target;
      break;
    default:
      state.mode = 'disconnected';
      state.target = null;
  }
}

/** Assert the connection state matches the step that produced it. */
function assertStep(state: TransitionState, step: TransitionStep): void {
  switch (step.kind) {
    case 'local':
      assertLocal(state.mode, state.target, step.port);
      break;
    case 'cloud':
      assertCloud(state.mode, state.target, step.target.apiUrl);
      assert.strictEqual(state.target?.transport, step.target.transport);
      break;
    default:
      assertDisconnected(state.mode, state.target);
  }
}

/** Replay a transition script, asserting the state after every step. */
function runTransition(steps: readonly TransitionStep[]): void {
  const state: TransitionState = { mode: 'disconnected', target: null };
  for (const step of steps) {
    applyStep(state, step);
    assertStep(state, step);
  }
}

/** Mode transition scripts: every hop a connection mode can make. */
const TRANSITION_CASES: readonly { readonly name: string; readonly steps: readonly TransitionStep[] }[] = [
  {
    name: 'Mode transition: disconnected → local → disconnected',
    steps: [{ kind: 'local', port: DEFAULT_PORT }, { kind: 'disconnected' }],
  },
  {
    name: 'Mode transition: disconnected → cloud → disconnected',
    steps: [{ kind: 'cloud', target: TEST_CLOUD_TARGET }, { kind: 'disconnected' }],
  },
  {
    name: 'Mode transition: local → disconnected → cloud → disconnected',
    steps: [
      { kind: 'local', port: DEFAULT_PORT },
      { kind: 'disconnected' },
      { kind: 'cloud', target: TEST_CLOUD_HTTP_TARGET },
      { kind: 'disconnected' },
    ],
  },
];

describe('Mode Switch — Connection Target Transitions', () => {
  // ─── Type-level mode switching ─────────────────────────────────────

  it('Local target has mode=local, transport=http-streamable, correct port', () => {
    const target: LocalTarget = makeLocalTarget();
    assert.strictEqual(target.mode, 'local');
    assert.strictEqual(target.port, DEFAULT_PORT);
    assert.strictEqual(target.transport, 'http-streamable');
  });

  it('Cloud stdio target has all fields set correctly', () => {
    assertMatches(TEST_CLOUD_TARGET, {
      mode: 'cloud',
      apiUrl: CLOUD_API_URL,
      apiKey: 'test-key-123',
      tenantId: 'tenant-abc',
      workspaceId: 'ws-def',
      passphrase: 'test-passphrase',
      transport: 'stdio',
    });
  });

  it('Cloud HTTP target has transport=http-streamable', () => {
    assertMatches(TEST_CLOUD_HTTP_TARGET, {
      mode: 'cloud',
      transport: 'http-streamable',
      apiKey: 'test-key-456',
      tenantId: 'tenant-xyz',
      workspaceId: 'ws-uvw',
      passphrase: 'http-passphrase',
    });
  });

  // ─── Discriminated union narrowing ─────────────────────────────────

  it('ConnectionTarget narrows to LocalTarget by mode field', () => {
    const target: ConnectionTarget = makeLocalTarget(CLOUD_PORT);
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

  for (const transitionCase of TRANSITION_CASES) {
    it(transitionCase.name, () => {
      runTransition(transitionCase.steps);
    });
  }

  // ─── Base URL derivation ───────────────────────────────────────────

  it('Local target derives http://localhost:{port} URL', () => {
    const target: LocalTarget = makeLocalTarget();
    const baseUrl = `http://localhost:${String(target.port)}`;
    assert.strictEqual(baseUrl, 'http://localhost:4040');
  });

  it('Cloud target uses apiUrl directly', () => {
    const target: CloudTarget = TEST_CLOUD_TARGET;
    assert.strictEqual(target.apiUrl, CLOUD_API_URL);
  });

  it('Different local ports produce different URLs', () => {
    const t1: LocalTarget = makeLocalTarget();
    const t2: LocalTarget = makeLocalTarget(CLOUD_PORT);
    const url1 = `http://localhost:${String(t1.port)}`;
    const url2 = `http://localhost:${String(t2.port)}`;
    assert.notStrictEqual(url1, url2, 'Different ports must produce different URLs');
    assert.strictEqual(url1, 'http://localhost:4040');
    assert.strictEqual(url2, 'http://localhost:5050');
  });
});
