// Real-server E2E — proves the VSIX "Start Local Server" path SPAWNS a working server.
//
// The connection-switcher suite (connectionSwitcherLocal.test.ts) only CONNECTS
// to a server the harness already started; nothing there exercises the
// extension's own "Start Local Server" path — which is exactly where
// `spawn too-many-cooks ENOENT` came from (Issue #17 / the npx fix).
//
// This test drives the REAL connection-manager lifecycle
// (createConnectionManager().startLocal) to spawn a genuine too-many-cooks
// server — the same build/bin/server.js that `npx too-many-cooks` executes — on
// an isolated workspace and a dedicated port, proves it actually serves HTTP,
// then proves disconnect() terminates the spawned process.
//
// Deliberately free of the `vscode` module so the exact same lifecycle can also
// be validated outside the Extension Host under plain `mocha`.
//
// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md  [CONN-LOCAL-SPAWN]

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildLocalLaunchSpec,
  createConnectionManager,
} from '../../src/services/connectionManager';
import type { ConnectionManager, LocalLaunchSpec } from '../../src/services/connectionManager';
import type { ConnectionTarget } from '../../src/services/connectionTypes';
import { checkServerAvailable, isRecord } from '../../src/services/httpClient';

/** Port distinct from the suite's shared 4040 server, so the two never clash. */
const TEST_PORT: number = 4141;
const BASE_URL: string = `http://localhost:${String(TEST_PORT)}`;
const STATUS_URL: string = `${BASE_URL}/admin/status`;

/** System Node launches the server child (matches the e2e shell scripts). */
const NODE_COMMAND: string = 'node';

/** Built server entry — the exact file the `too-many-cooks` bin (hence
 *  `npx too-many-cooks`) executes. Resolved from this compiled test's location:
 *  out/test/suite -> extension root -> repo root -> the MCP package build. */
const SERVER_ENTRY: string = path.resolve(
  __dirname, '..', '..', '..', '..',
  'too-many-cooks', 'packages', 'too-many-cooks', 'build', 'bin', 'server.js',
);

/** Package the production default launches via npx (always-latest, no global install). */
const EXPECTED_PACKAGE: string = 'too-many-cooks@latest';

/** Top-level keys a healthy /admin/status payload must return. */
const STATUS_KEYS: readonly string[] = ['agents', 'locks', 'plans', 'messages'];

/** Cold server build + SQLite DB creation can take a few seconds. */
const TEST_TIMEOUT_MS: number = 60000;
const DOWN_POLL_TIMEOUT_MS: number = 10000;
const DOWN_POLL_INTERVAL_MS: number = 100;

function assertOk(value: unknown, message: string): void {
  if (!value) { throw new Error(`Assertion failed: ${message}`); }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => { setTimeout(resolve, ms); });
}

/** Poll until the server stops responding (proves the spawned child was killed). */
async function waitForServerDown(): Promise<boolean> {
  const deadline: number = Date.now() + DOWN_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const up: boolean = await checkServerAvailable(BASE_URL);
    if (!up) { return true; }
    await delay(DOWN_POLL_INTERVAL_MS);
  }
  return false;
}

/** Fetch /admin/status and return its parsed object, or null if unavailable. */
async function fetchStatus(): Promise<Record<string, unknown> | null> {
  const response: Response = await fetch(STATUS_URL);
  if (!response.ok) { return null; }
  const body: unknown = await response.json();
  return isRecord(body) ? body : null;
}

suite('Start Local Server spawns a real server (E2E)', () => {
  let manager: ConnectionManager | null = null;
  let workspace: string | null = null;

  suiteTeardown(() => {
    if (manager !== null) { manager.disconnect(); manager = null; }
    if (workspace !== null) { fs.rmSync(workspace, { recursive: true, force: true }); workspace = null; }
  });

  test('production default launches `npx -y too-many-cooks@latest` (no global install)', () => {
    const spec: LocalLaunchSpec = buildLocalLaunchSpec();
    assertEqual(spec.command, 'npx', 'default command must be npx');
    assertOk(spec.args.includes(EXPECTED_PACKAGE), 'default must run too-many-cooks@latest');
    assertOk(spec.args.includes('-y'), 'default must pass -y');
  });

  test('startLocal spawns a real server, it serves HTTP, disconnect kills it', async function (): Promise<void> {
    this.timeout(TEST_TIMEOUT_MS);

    assertOk(fs.existsSync(SERVER_ENTRY), `built server must exist at ${SERVER_ENTRY} — build the MCP server first`);
    assertOk(!(await checkServerAvailable(BASE_URL)), `port ${String(TEST_PORT)} must be free before the test`);

    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tmc-e2e-start-'));
    const launch: LocalLaunchSpec = { args: [SERVER_ENTRY], command: NODE_COMMAND };
    const logs: string[] = [];
    manager = createConnectionManager(workspace, (m: string): void => { logs.push(m); }, launch);

    // ── Drive the REAL extension lifecycle: spawn + poll-until-ready ──
    await manager.startLocal(TEST_PORT);

    assertEqual(manager.getMode(), 'local', 'mode is local after a successful spawn');
    const target: ConnectionTarget | null = manager.getTarget();
    if (target === null) { throw new Error('Assertion failed: connection target is set'); }
    assertEqual(target.mode, 'local', 'target mode is local');
    assertEqual(target.transport, 'http-streamable', 'target transport is http-streamable');

    // ── The server is genuinely up and functional, not just a bound port ──
    assertOk(await checkServerAvailable(BASE_URL), 'spawned server responds on /admin/status');
    const status: Record<string, unknown> | null = await fetchStatus();
    if (status === null) { throw new Error('Assertion failed: /admin/status returns a JSON object'); }
    for (const key of STATUS_KEYS) {
      assertOk(key in status, `status payload includes "${key}"`);
    }
    assertOk(logs.some((l: string): boolean => l.includes('Spawning local server')), 'logged the spawn attempt');
    assertOk(logs.some((l: string): boolean => l.includes('Server ready')), 'logged server-ready');

    // ── disconnect() must terminate the spawned process ──
    manager.disconnect();
    assertEqual(manager.getMode(), 'disconnected', 'mode is disconnected after disconnect');
    assertOk(await waitForServerDown(), 'disconnect terminated the spawned server (port stops responding)');
    manager = null;
  });
});
