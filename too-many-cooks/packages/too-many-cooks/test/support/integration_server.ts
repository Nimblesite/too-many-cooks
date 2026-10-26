/// Shared spawned-server fixture for the integration test files
/// ([DEDUP-DESLOP]).
///
/// Each integration feature file gets its own port and temp
/// workspace; the fixture spawns the server, waits until /mcp
/// accepts initialize, resets the DB via admin between tests, and
/// hands out fresh MCP clients.

import { after, before, beforeEach } from "node:test";
import type { ChildProcess } from "node:child_process";

import {
  type SpawnedServer,
  buildBaseUrl,
  killServer,
  resetServerViaAdmin,
  sleep,
  spawnServer,
  waitForServer,
} from "./server_process.js";
import {
  ACCEPT_STREAMABLE,
  CONTENT_TYPE_JSON,
  JSONRPC_VERSION,
  LEGACY_PROTOCOL_VERSION,
  MCP_PATH,
  McpHttpClient,
  type ClientInfo,
} from "./mcp_http.js";
import { removeTree } from "./fs_helpers.js";
import { getStringField, parseJsonRecord } from "./json.js";

const HEALTH_CHECK_ATTEMPTS = 10;
const HEALTH_POLL_INTERVAL_MS = 200;
const HEALTH_REQUEST_ID = 0;
const CLIENT_INFO: ClientInfo = { name: "test-client", version: "1.0.0" };
const HEALTH_CLIENT_INFO: ClientInfo = { name: "health-check", version: "1.0.0" };

export type IntegrationServer = {
  readonly baseUrl: string;
  /** Spawns the server and waits until it accepts /mcp requests. */
  readonly start: () => Promise<ChildProcess>;
  /** Kills the server and removes its temp workspace. */
  readonly stop: (serverProcess: ChildProcess) => void;
  /** Resets the DB via admin, then returns a freshly initialized client. */
  readonly freshClient: () => Promise<McpHttpClient>;
};

/** Probe: does POST /mcp initialize succeed yet? */
const mcpEndpointReady = async (baseUrl: string): Promise<boolean> => {
  try {
    const r = await fetch(`${baseUrl}${MCP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": CONTENT_TYPE_JSON, Accept: ACCEPT_STREAMABLE },
      body: JSON.stringify({
        jsonrpc: JSONRPC_VERSION,
        id: HEALTH_REQUEST_ID,
        method: "initialize",
        params: {
          protocolVersion: LEGACY_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: HEALTH_CLIENT_INFO,
        },
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
};

/** Wait for /admin/status, then verify /mcp accepts requests. */
const waitForServerReady = async (baseUrl: string): Promise<void> => {
  await waitForServer(baseUrl);
  for (let i = 0; i < HEALTH_CHECK_ATTEMPTS; i++) {
    if (await mcpEndpointReady(baseUrl)) { return; }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
};

const newClient = (baseUrl: string): McpHttpClient =>
  new McpHttpClient({
    baseUrl,
    protocolVersion: LEGACY_PROTOCOL_VERSION,
    clientInfo: CLIENT_INFO,
  });

/** Creates the per-file server fixture bound to a port and tmp prefix. */
export const createIntegrationServer = (
  port: number,
  tmpPrefix: string,
): IntegrationServer => {
  const baseUrl = buildBaseUrl(port);
  let spawned: SpawnedServer | undefined;
  return {
    baseUrl,
    start: async (): Promise<ChildProcess> => {
      spawned = spawnServer({ port, tmpPrefix });
      await waitForServerReady(baseUrl);
      return spawned.proc;
    },
    stop: (serverProcess: ChildProcess): void => {
      killServer(serverProcess);
      if (spawned !== undefined) {
        removeTree(spawned.workspace);
      }
    },
    freshClient: async (): Promise<McpHttpClient> => {
      await resetServerViaAdmin(baseUrl);
      const client = newClient(baseUrl);
      await client.initSession();
      return client;
    },
  };
};

/** Server lifecycle + per-test client for an integration describe block. */
export type IntegrationSuite = {
  /** The running server process (after `before` has run). */
  readonly serverProcess: () => ChildProcess;
  /** The per-test MCP client (fresh session each test). */
  readonly client: () => McpHttpClient;
};

/** Wires before/after/beforeEach around a server fixture ([DEDUP-DESLOP]). */
export const bindIntegrationLifecycle = (
  server: IntegrationServer,
): IntegrationSuite => {
  let serverProc: ChildProcess | undefined;
  let client: McpHttpClient | undefined;
  before(async () => {
    serverProc = await server.start();
  });
  after(() => {
    if (serverProc === undefined) { throw new Error("server never started"); }
    server.stop(serverProc);
  });
  beforeEach(async () => {
    client = await server.freshClient();
  });
  return {
    serverProcess: (): ChildProcess => {
      if (serverProc === undefined) { throw new Error("server not started"); }
      return serverProc;
    },
    client: (): McpHttpClient => {
      if (client === undefined) { throw new Error("no client for test"); }
      return client;
    },
  };
};

export type Agent = { readonly name: string; readonly key: string };

/** Registers `count` agents concurrently; returns their name/key pairs. */
export const registerAgents = async (
  client: McpHttpClient,
  count: number,
): Promise<readonly Agent[]> => {
  const timestamp = Date.now();
  const registerPromises = Array.from({ length: count }, async (_, i) =>
    client.callTool("register", { name: `agent${String(timestamp)}_${String(i)}` }),
  );
  const regResults = await Promise.all(registerPromises);
  return regResults.map((r) => {
    const json = parseJsonRecord(r);
    return {
      name: getStringField(json, "agent_name"),
      key: getStringField(json, "agent_key"),
    };
  });
};
