// [CONN-LOCAL-SPAWN] The documented path, end to end through the UI: run
// "Choose Connection Mode", pick "Start Local Server" in the real Quick Pick,
// and the extension spawns its bundled server, which creates its database, and
// the extension writes the agent config and connects. Nothing here starts a
// server for the extension: if the VSIX cannot create one, this fails. Stopping
// the spawned server is proven in connectionSwitcherStartServer.test.ts.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { isRecord } from '../../src/services/httpClient';
import {
  assertEqual,
  assertOk,
  getTestAPI,
  reconnectToTestServer,
  safeDisconnect,
  waitForExtensionActivation,
} from './testHelpers';

/** A port of its own, clear of the suite's shared 4040 server. */
const PICKER_PORT: number = 4143;
const STATUS_URL: string = `http://localhost:${String(PICKER_PORT)}/admin/status`;
const SECTION: string = 'tooManyCooks';
const PORT_SETTING: string = 'port';
const COMMAND: string = 'tooManyCooks.chooseConnection';
const ACCEPT: string = 'quickInput.accept';
const STATUS_KEYS: readonly string[] = ['agents', 'locks', 'plans', 'messages'];
const SERVER_NAME: string = 'too-many-cooks';
/** A cold bundled binary creates its database before it answers. */
const TIMEOUT_MS: number = 60000;
const POLL_MS: number = 200;

/** Poll `check` until it holds or the timeout passes. */
async function until(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline: number = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) { return; }
    await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, POLL_MS); });
  }
  throw new Error(`Timed out: ${message}`);
}

/** The server's status payload, or null while nothing answers. */
async function serverStatus(): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await (await fetch(STATUS_URL)).json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

/** Run the picker command and press Enter on its first row, Start Local Server, as soon as it opens. */
async function pickStartLocalServer(): Promise<void> {
  let settled: boolean = false;
  const picking: Thenable<unknown> = vscode.commands.executeCommand(COMMAND);
  void Promise.resolve(picking).finally((): void => { settled = true; });
  // The Quick Pick opens a moment after the command starts; Enter on no picker does nothing.
  await until(async (): Promise<boolean> => {
    await vscode.commands.executeCommand(ACCEPT);
    return settled;
  }, 'the connection picker never took Start Local Server');
  await picking;
}

suite('Start Local Server from the connection picker', () => {
  const root: string = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const marker: string = path.join(root, '.claude');
  const config: string = path.join(root, '.mcp.json');
  const hadMarker: boolean = fs.existsSync(marker);
  const hadConfig: boolean = fs.existsSync(config);

  suiteSetup(async function setUp (): Promise<void> {
    this.timeout(TIMEOUT_MS);
    assertOk(root.length > 0, 'the suite runs on a workspace folder');
    await waitForExtensionActivation();
    await safeDisconnect();
    // Claude Code is detected by its folder, so the picker writes its config.
    fs.mkdirSync(marker, { recursive: true });
    await vscode.workspace.getConfiguration(SECTION).update(PORT_SETTING, PICKER_PORT, vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async function tearDown (): Promise<void> {
    this.timeout(TIMEOUT_MS);
    await vscode.workspace.getConfiguration(SECTION).update(PORT_SETTING, undefined, vscode.ConfigurationTarget.Global);
    if (!hadMarker) { fs.rmSync(marker, { recursive: true, force: true }); }
    if (!hadConfig) { fs.rmSync(config, { force: true }); }
    // A full disconnect first: switching targets while connected would let the next suite
    // see "connected" before its event stream to the suite server is up.
    await safeDisconnect();
    await reconnectToTestServer(getTestAPI());
  });

  test('spawns the bundled server, which creates its database; writes the agent config; connects', async function startFromPicker (): Promise<void> {
    this.timeout(TIMEOUT_MS * 2);
    assertEqual(await serverStatus(), null, 'nothing listens on the picker port before the pick');

    await pickStartLocalServer();
    await until(async (): Promise<boolean> => (await serverStatus()) !== null, 'the spawned server never answered');
    const status: Record<string, unknown> | null = await serverStatus();
    for (const key of STATUS_KEYS) { assertOk(Array.isArray(status?.[key]), `/admin/status has ${key}`); }

    const api = getTestAPI();
    assertOk(api.isConnected(), 'the extension connected to the server it spawned');
    assertEqual(api.getConnectionStatus(), 'connected', 'connection status');

    const written: unknown = JSON.parse(fs.readFileSync(config, 'utf-8'));
    const servers: unknown = isRecord(written) ? written['mcpServers'] : null;
    const entry: unknown = isRecord(servers) ? servers[SERVER_NAME] : null;
    assertOk(isRecord(entry), '.mcp.json names the too-many-cooks server');
    assertOk(JSON.stringify(entry).includes(`localhost:${String(PICKER_PORT)}/mcp`), '.mcp.json points at the spawned server');
    assertOk(api.getLogMessages().some((line: string): boolean => line.includes('Database created')), 'the spawned server created its database');
  });
});
