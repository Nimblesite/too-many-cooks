/// Shared Streamable-HTTP E2E stream helpers ([DEDUP-DESLOP]).
///
/// The streaming E2E files each re-declared the admin-events stream
/// opener and the spawned-server before/after lifecycle. These
/// non-assertion helpers centralize both.

import { after, before } from "node:test";
import type { ChildProcess } from "node:child_process";

import {
  type SpawnedServer,
  killServer,
  spawnServer,
  waitForServer,
} from "./server_process.js";
import {
  ACCEPT_STREAMABLE,
  ADMIN_EVENTS_PATH,
  initAdminEventsSession,
  type ClientInfo,
} from "./mcp_http.js";
import { SseEventCollector } from "./sse.js";
import { removeTree } from "./fs_helpers.js";

/** Opens the admin GET /admin/events notification stream. */
export const connectAdminEventsStream = async (
  baseUrl: string,
  clientInfo: ClientInfo,
): Promise<SseEventCollector> => {
  const sessionId = await initAdminEventsSession(baseUrl, clientInfo);
  return SseEventCollector.open({
    url: `${baseUrl}${ADMIN_EVENTS_PATH}`,
    headers: { Accept: ACCEPT_STREAMABLE, "mcp-session-id": sessionId },
  });
};

/** Wires before/after around a spawned server ([DEDUP-DESLOP]). */
export const bindSpawnedServer = (
  port: number,
  tmpPrefix: string,
  baseUrl: string,
): void => {
  let spawned: SpawnedServer | undefined;
  let serverProcess: ChildProcess | undefined;
  before(async () => {
    spawned = spawnServer({ port, tmpPrefix });
    serverProcess = spawned.proc;
    await waitForServer(baseUrl);
  });
  after(() => {
    if (serverProcess === undefined) { throw new Error("server never started"); }
    killServer(serverProcess);
    if (spawned !== undefined) { removeTree(spawned.workspace); }
  });
};
