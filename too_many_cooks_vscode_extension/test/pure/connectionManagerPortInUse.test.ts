/// [CONN-LOCAL-PORT-IN-USE] "Start Local Server" on a port something else
/// already holds must fail loudly, naming the port and the process holding it,
/// and saying when that process answers as a Too Many Cooks server. It must not
/// spawn a doomed server and silently latch onto (or time out against) the
/// occupant.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createConnectionManager } from '../../src/services/connectionManager';
import type { ConnectionManager, LocalLaunchSpec } from '../../src/services/connectionManager';
import { createLogCollector } from './testSupport';

const OCCUPIED_PORT: number = 4097;
const STATUS_PATH: string = '/admin/status';
const HTTP_OK: number = 200;
const HTTP_NOT_FOUND: number = 404;
const NEVER_SPAWNED: LocalLaunchSpec = { args: [], command: '/nonexistent/tmc-must-not-be-spawned' };
const GENERIC_TIMEOUT_FRAGMENT: string = 'did not start within';
const SPAWN_LOG_FRAGMENT: string = 'Spawning local server';
const OCCUPANT_NAME: RegExp = /node/iu;

/** Occupy the port with a server that answers /admin/status like TMC (or not). */
async function occupy(answersAsTmc: boolean): Promise<Server> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse): void => {
    res.statusCode = answersAsTmc && req.url === STATUS_PATH ? HTTP_OK : HTTP_NOT_FOUND;
    res.end();
  });
  await new Promise<void>((resolve: () => void): void => { server.listen(OCCUPIED_PORT, resolve); });
  return server;
}

async function release(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve: () => void): void => { server.close((): void => { resolve(); }); });
}

/** Start on the occupied port; return the rejection message and the logs. */
async function startOnOccupiedPort(answersAsTmc: boolean): Promise<{ readonly logs: readonly string[]; readonly message: string; readonly mode: string }> {
  const server: Server = await occupy(answersAsTmc);
  const { log, logs } = createLogCollector();
  const cm: ConnectionManager = createConnectionManager('/tmp/tmc-test', log, NEVER_SPAWNED);
  let message: string = '';
  try {
    await assert.rejects(cm.startLocal(OCCUPIED_PORT), (err: unknown): boolean => {
      assert.ok(err instanceof Error, 'rejects with an Error');
      message = err.message;
      return true;
    });
  } finally {
    await release(server);
  }
  return { logs, message, mode: cm.getMode() };
}

describe('ConnectionManager start on an occupied port', () => {
  it('reports the port, the occupying process, and that it is a TMC server', async () => {
    const { logs, message, mode } = await startOnOccupiedPort(true);

    assert.ok(message.includes(String(OCCUPIED_PORT)), `names the port: ${message}`);
    assert.match(message, /already in use/iu, `says the port is taken: ${message}`);
    assert.ok(message.includes(`PID ${String(process.pid)}`), `names the occupying PID ${String(process.pid)}: ${message}`);
    assert.match(message, OCCUPANT_NAME, `names the occupying program: ${message}`);
    assert.match(message, /Too Many Cooks/u, `says the occupant is a TMC server: ${message}`);
    assert.ok(!message.includes(GENERIC_TIMEOUT_FRAGMENT), `not masked by the startup timeout: ${message}`);
    assert.ok(!logs.some((l: string): boolean => l.includes(SPAWN_LOG_FRAGMENT)), 'no doomed server is spawned');
    assert.ok(logs.some((l: string): boolean => l.includes(String(OCCUPIED_PORT)) && /in use/iu.test(l)), `the conflict is logged: ${logs.join(' | ')}`);
    assert.strictEqual(mode, 'disconnected', 'does not latch onto the occupant');
  });

  it('reports a non-TMC occupant without calling it a TMC server', async () => {
    const { logs, message, mode } = await startOnOccupiedPort(false);

    assert.ok(message.includes(String(OCCUPIED_PORT)), `names the port: ${message}`);
    assert.match(message, /already in use/iu, `says the port is taken: ${message}`);
    assert.ok(message.includes(`PID ${String(process.pid)}`), `names the occupying PID: ${message}`);
    assert.match(message, OCCUPANT_NAME, `names the occupying program: ${message}`);
    assert.doesNotMatch(message, /Too Many Cooks/u, `does not claim a TMC server: ${message}`);
    assert.ok(!message.includes(GENERIC_TIMEOUT_FRAGMENT), `not masked by the startup timeout: ${message}`);
    assert.ok(!logs.some((l: string): boolean => l.includes(SPAWN_LOG_FRAGMENT)), 'no doomed server is spawned');
    assert.strictEqual(mode, 'disconnected', 'stays disconnected');
  });
});
