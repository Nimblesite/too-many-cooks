/// Shared Streamable-HTTP E2E stream helpers ([DEDUP-DESLOP]).
///
/// The streaming E2E files each re-declared the admin-events stream
/// opener and the spawned-server before/after lifecycle. These
/// non-assertion helpers centralize both.

import { after, before } from "node:test";
import type { ChildProcess } from "node:child_process";
import assert from "node:assert";

import {
  type SpawnedServer,
  killServer,
  spawnServer,
  waitForServer,
} from "./server_process.js";
import {
  ACCEPT_STREAMABLE,
  ADMIN_EVENTS_PATH,
  MCP_PATH,
  SESSION_ID_HEADER,
  initAdminEventsSession,
  type ClientInfo,
} from "./mcp_http.js";
import { SseEventCollector, DEFAULT_EVENT_TIMEOUT_MS } from "./sse.js";
import { parseJsonRecord } from "./json.js";
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

/** Opens an AGENT's GET /mcp notification stream. */
export const connectAgentEventsStream = async (
  baseUrl: string,
  sessionId: string,
  settleMs?: number,
): Promise<SseEventCollector> =>
  SseEventCollector.open({
    url: `${baseUrl}${MCP_PATH}`,
    headers: { Accept: ACCEPT_STREAMABLE, [SESSION_ID_HEADER]: sessionId },
    ...(settleMs === undefined ? {} : { settleMs }),
  });

/** Event waiter bound to one timeout budget. */
export type EventWaiter = (
  stream: SseEventCollector,
  count: number,
) => Promise<string[]>;

/** Builds an event waiter that uses `timeoutMs` for every wait. */
export const eventWaiter = (timeoutMs: number): EventWaiter =>
  async (stream: SseEventCollector, count: number): Promise<string[]> =>
    stream.waitForEvents(count, timeoutMs);

/** Waits for `stream`'s first event, closes it, and returns the raw payload. */
export const firstStreamEvent = async (
  stream: SseEventCollector,
  timeoutMs: number = DEFAULT_EVENT_TIMEOUT_MS,
): Promise<string> => {
  const events = await stream.waitForEvents(1, timeoutMs);
  stream.close();
  assert.ok(events.length > 0, "stream must deliver at least one event");
  const first = events[0];
  assert.ok(first !== undefined, "stream event must be defined");
  return first;
};

/** Waits for `stream`'s first event, closes it, returns the parsed payload. */
export const firstStreamEventJson = async (
  stream: SseEventCollector,
  timeoutMs: number = DEFAULT_EVENT_TIMEOUT_MS,
): Promise<Record<string, unknown>> =>
  parseJsonRecord(await firstStreamEvent(stream, timeoutMs));

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
