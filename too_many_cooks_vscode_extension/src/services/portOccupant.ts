// [CONN-LOCAL-PORT-IN-USE] Detects a port already held by another process and
// Describes that process, so "Start Local Server" can say what is in the way
// Instead of spawning a server that dies with EADDRINUSE.

import type { Server } from 'node:net';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run: (file: string, args: readonly string[]) => Promise<{ readonly stdout: string }> = promisify(execFile);

const WIN32: NodeJS.Platform = 'win32';
const LSOF: string = 'lsof';
const NETSTAT: string = 'netstat';
const TASKLIST: string = 'tasklist';
const UNKNOWN_PROCESS: string = 'an unknown process';
const NEWLINE: RegExp = /\r?\n/u;
const WHITESPACE: RegExp = /\s+/u;
const CSV_FIELD: RegExp = /^"(?<field>[^"]*)"/u;
const LSOF_PID: RegExp = /^p(?<pid>\d+)$/mu;
const LSOF_COMMAND: RegExp = /^c(?<command>.+)$/mu;
const NETSTAT_LISTENING: string = 'LISTENING';
const NETSTAT_LOCAL_COLUMN: number = 1;
const NETSTAT_PID_COLUMN: number = 4;
const ADDRESS_IN_USE: string = 'EADDRINUSE';

/** A process holding a port. */
interface Occupant {
  readonly command: string;
  readonly pid: string;
}

/** True unless something is listening on the port. Other bind errors (e.g.
 * EACCES on a privileged port) are not occupancy; the spawn reports them. */
export async function isPortFree(port: number): Promise<boolean> {
  const probe: Server = createServer();
  return await new Promise<boolean>((resolve: (free: boolean) => void): void => {
    probe.once('error', (err: NodeJS.ErrnoException): void => { resolve(err.code !== ADDRESS_IN_USE); });
    probe.listen(port, (): void => { probe.close((): void => { resolve(true); }); });
  });
}

/** Parse `lsof -Fpc` output: `p<pid>` then `c<command>` lines. */
function parseLsof(stdout: string): Occupant | null {
  const pid: string | null = LSOF_PID.exec(stdout)?.groups?.['pid'] ?? null;
  const command: string = LSOF_COMMAND.exec(stdout)?.groups?.['command'] ?? UNKNOWN_PROCESS;
  return pid === null ? null : { command, pid };
}

async function findPosixOccupant(port: number): Promise<Occupant | null> {
  const { stdout } = await run(LSOF, ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-Fpc']);
  return parseLsof(stdout);
}

/** The PID listening on the port per `netstat -ano`, or null. */
function parseNetstatPid(stdout: string, port: number): string | null {
  const suffix: string = `:${String(port)}`;
  const rows: ReadonlyArray<readonly string[]> = stdout.split(NEWLINE)
    .map((line: string): readonly string[] => { return line.trim().split(WHITESPACE); });
  const row: readonly string[] | null = rows.find((cols: readonly string[]): boolean => {
    return cols.includes(NETSTAT_LISTENING) && (cols[NETSTAT_LOCAL_COLUMN] ?? '').endsWith(suffix);
  }) ?? null;
  return row?.[NETSTAT_PID_COLUMN] ?? null;
}

async function findWindowsOccupant(port: number): Promise<Occupant | null> {
  const pid: string | null = parseNetstatPid((await run(NETSTAT, ['-ano', '-p', 'TCP'])).stdout, port);
  if (pid === null) { return null; }
  const { stdout } = await run(TASKLIST, ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
  return { command: CSV_FIELD.exec(stdout.trim())?.groups?.['field'] ?? UNKNOWN_PROCESS, pid };
}

/** Describe the process holding the port, e.g. `node (PID 123)`. */
export async function describeOccupant(port: number): Promise<string> {
  try {
    const occupant: Occupant | null = process.platform === WIN32 ? await findWindowsOccupant(port) : await findPosixOccupant(port);
    return occupant === null ? UNKNOWN_PROCESS : `${occupant.command} (PID ${occupant.pid})`;
  } catch {
    return UNKNOWN_PROCESS;
  }
}

