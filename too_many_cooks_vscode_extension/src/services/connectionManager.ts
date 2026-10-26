// Connection manager — orchestrates local server lifecycle and cloud credential validation.
//
// Phase 1 of the VSIX connection switcher.
// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md

import type { CloudTarget, ConnectionMode, ConnectionTarget, LocalTarget } from './connectionTypes';
import type { ChildProcess } from 'node:child_process';
import { checkServerAvailable } from './httpClient';
import { spawn } from 'node:child_process';

/** Log function signature (same as StoreManager). */
type LogFn = (msg: string) => void;

/** Default local server port. */
const DEFAULT_LOCAL_PORT: number = 4040;

/** Server startup poll interval in ms. */
const POLL_INTERVAL_MS: number = 200;

/** Server startup timeout in ms. */
const STARTUP_TIMEOUT_MS: number = 15000;

/** Grace period before SIGKILL after SIGTERM (ms). */
const KILL_GRACE_MS: number = 3000;

/** TMC_PORT environment variable name. */
const TMC_PORT_ENV: string = 'TMC_PORT';

/** TMC_WORKSPACE environment variable name. */
const TMC_WORKSPACE_ENV: string = 'TMC_WORKSPACE';

/** Local base URL prefix. */
const LOCAL_BASE_URL_PREFIX: string = 'http://localhost:';

/** Cloud validation endpoint (matches cloud-connection.ts pattern). */
const CLOUD_VALIDATE_ENDPOINT: string = 'listAgents';

/** Authorization header key. */
const AUTHORIZATION_HEADER: string = 'Authorization';

/** Authorization bearer prefix. */
const AUTH_BEARER_PREFIX: string = 'Bearer ';

/** Content-Type header key. */
const CONTENT_TYPE_HEADER: string = 'Content-Type';

/** Content-Type JSON value. */
const CONTENT_TYPE_JSON: string = 'application/json';

/** Workspace ID header key. */
const WORKSPACE_ID_HEADER: string = 'X-Workspace-Id';

/** Tenant ID header key. */
const TENANT_ID_HEADER: string = 'X-Tenant-Id';

/** HTTP POST method. */
const HTTP_POST: string = 'POST';

/** Empty JSON body. */
const EMPTY_JSON_BODY: string = '{}';

/** Default transport for local connections (typed via LocalTarget.transport). */
const LOCAL_TRANSPORT: LocalTarget['transport'] = 'http-streamable';

/** How to launch the local server child process: a command plus its arguments. */
export interface LocalLaunchSpec {
  readonly args: readonly string[];
  readonly command: string;
}

/** Resolves the launch spec when a local server is started — in production
 *  the bundled, version-verified binary (serverResolver.ts). */
export type LaunchResolver = () => Promise<LocalLaunchSpec>;

/** Message when no launch was wired (never the case in the extension). */
const NO_LAUNCH_MESSAGE: string = 'No local server launch is configured';

/** Default resolver: refuses rather than guessing a binary. */
async function noLaunch(): Promise<LocalLaunchSpec> {
  return await Promise.reject(new Error(NO_LAUNCH_MESSAGE));
}

/** A fixed launch spec (tests, explicit overrides) or a resolver, as a resolver. */
function toLaunchResolver(launch: LaunchResolver | LocalLaunchSpec): LaunchResolver {
  if (typeof launch === 'function') { return launch; }
  return async (): Promise<LocalLaunchSpec> => { return await Promise.resolve(launch); };
}

/** Connection manager interface. */
export interface ConnectionManager {
  readonly connectCloud: (target: CloudTarget) => Promise<void>;
  readonly disconnect: () => void;
  readonly getMode: () => ConnectionMode;
  readonly getTarget: () => ConnectionTarget | null;
  readonly startLocal: (port?: number) => Promise<void>;
}

/** Internal mutable state for the connection manager. */
interface ManagerState {
  localProcess: ChildProcess | null;
  mode: ConnectionMode;
  target: ConnectionTarget | null;
}

/** Everything needed to spawn and reach the local server. */
interface LocalServerSpec {
  readonly args: readonly string[];
  readonly command: string;
  readonly port: number;
  readonly workspaceFolder: string;
}

/** Build the local base URL for a given port. */
function buildLocalBaseUrl(port: number): string {
  return `${LOCAL_BASE_URL_PREFIX}${String(port)}`;
}

/** Spawn configuration for the local server. The server is a real executable
 *  (bundled .exe on Windows), so no platform needs a shell — and a shell would
 *  split an extension path containing spaces and turn a missing binary into a
 *  shell exit code instead of an ENOENT 'error' event (Issue #17). */
export function buildLocalSpawnConfig(_platform: NodeJS.Platform): { readonly shell: boolean } {
  return { shell: false };
}

/** Poll until the local server responds on /admin/status. Stops early if the
 *  signal aborts (e.g. spawn failed first), so the loser of the startup race
 *  does not keep polling a dead port. */
async function pollUntilReady(baseUrl: string, log: LogFn, signal: AbortSignal): Promise<void> {
  const deadline: number = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && !signal.aborted) {
    const available: boolean = await checkServerAvailable(baseUrl);
    if (available) {
      log(`[ConnectionManager] Server ready at ${baseUrl}`);
      return;
    }
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }
  if (signal.aborted) { return; }
  throw new Error(`Local server did not start within ${String(STARTUP_TIMEOUT_MS)}ms`);
}

/** Spawn the too-many-cooks server as a child process. */
function spawnLocalServer(spec: LocalServerSpec, log: LogFn): ChildProcess {
  log(`[ConnectionManager] Spawning local server '${spec.command} ${spec.args.join(' ')}' on port ${String(spec.port)} (workspace: ${spec.workspaceFolder})`);
  const child: ChildProcess = spawn(spec.command, [...spec.args], {
    cwd: spec.workspaceFolder,
    detached: false,
    env: { ...process.env, [TMC_PORT_ENV]: String(spec.port), [TMC_WORKSPACE_ENV]: spec.workspaceFolder },
    shell: buildLocalSpawnConfig(process.platform).shell,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', (data: Buffer): void => {
    log(`[local-server] ${data.toString().trimEnd()}`);
  });
  child.on('exit', (code: number | null): void => {
    log(`[ConnectionManager] Local server exited (code: ${String(code)})`);
  });
  return child;
}

/** Resolve once the server is ready, or reject promptly if the child fails to
 *  spawn (ENOENT 'error'). Without this the failure is swallowed and the user
 *  only sees the misleading generic startup timeout. Issue #17. */
async function awaitServerReady(child: ChildProcess, spec: LocalServerSpec, log: LogFn): Promise<void> {
  const controller: AbortController = new AbortController();
  const failure: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (reason: Error) => void): void => {
      child.once('error', (err: Error): void => {
        reject(new Error(`Local server '${spec.command}' could not be started: ${err.message}`));
      });
    },
  );
  try {
    await Promise.race([pollUntilReady(buildLocalBaseUrl(spec.port), log, controller.signal), failure]);
  } finally {
    controller.abort();
    child.removeAllListeners('error');
  }
}

/** Kill a child process with SIGTERM, escalating to SIGKILL after grace period. */
function killProcess(child: ChildProcess, log: LogFn): void {
  log('[ConnectionManager] Sending SIGTERM to local server');
  child.kill('SIGTERM');
  const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
    if (child.exitCode === null) {
      log('[ConnectionManager] Grace period expired, sending SIGKILL');
      child.kill('SIGKILL');
    }
  }, KILL_GRACE_MS);
  child.once('exit', (): void => { clearTimeout(timer); });
}

/** Validate cloud credentials by calling the listAgents endpoint. */
async function validateCloudCredentials(target: CloudTarget, log: LogFn): Promise<void> {
  log(`[ConnectionManager] Validating cloud credentials at ${target.apiUrl}`);
  const response: Response = await fetch(`${target.apiUrl}/${CLOUD_VALIDATE_ENDPOINT}`, {
    body: EMPTY_JSON_BODY,
    headers: {
      [AUTHORIZATION_HEADER]: `${AUTH_BEARER_PREFIX}${target.apiKey}`,
      [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON,
      [TENANT_ID_HEADER]: target.tenantId,
      [WORKSPACE_ID_HEADER]: target.workspaceId,
    },
    method: HTTP_POST,
  });
  if (!response.ok) {
    throw new Error(`Cloud validation failed: HTTP ${String(response.status)}`);
  }
  log('[ConnectionManager] Cloud credentials validated');
}

/** Create a connection manager instance. */
export function createConnectionManager(
  workspaceFolder: string,
  log: LogFn,
  launch: LaunchResolver | LocalLaunchSpec = noLaunch,
): ConnectionManager {
  const resolveLaunch: LaunchResolver = toLaunchResolver(launch);
  const state: ManagerState = {
    localProcess: null,
    mode: 'disconnected',
    target: null,
  };

  function disconnect(): void {
    if (state.localProcess !== null) {
      killProcess(state.localProcess, log);
      state.localProcess = null;
    }
    state.mode = 'disconnected';
    state.target = null;
    log('[ConnectionManager] Disconnected');
  }

  async function startLocal(port: number = DEFAULT_LOCAL_PORT): Promise<void> {
    if (state.mode !== 'disconnected') { disconnect(); }
    const { args, command }: LocalLaunchSpec = await resolveLaunch();
    const spec: LocalServerSpec = { args, command, port, workspaceFolder };
    const child: ChildProcess = spawnLocalServer(spec, log);
    state.localProcess = child;
    await awaitServerReady(child, spec, log);
    Object.assign(state, { mode: 'local' satisfies ConnectionMode, target: { mode: 'local', port, transport: LOCAL_TRANSPORT } satisfies LocalTarget });
  }

  async function connectCloud(cloudTarget: CloudTarget): Promise<void> {
    if (state.mode !== 'disconnected') { disconnect(); }
    await validateCloudCredentials(cloudTarget, log);
    Object.assign(state, { mode: 'cloud' satisfies ConnectionMode, target: cloudTarget });
  }

  return {
    connectCloud,
    disconnect,
    getMode: (): ConnectionMode => { return state.mode; },
    getTarget: (): ConnectionTarget | null => { return state.target; },
    startLocal,
  };
}
