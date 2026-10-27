/// Test: server returns 404 for stale/unknown MCP session IDs.
///
/// BUG: POST /mcp with an unknown mcp-session-id returns 400
/// instead of 404. Per the MCP Streamable HTTP spec, 404 tells
/// the client the session expired and it should re-initialize.
/// Returning 400 leaves clients stuck - they think the request
/// format is wrong rather than the session being stale.

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import type { ChildProcess } from "node:child_process";

import {
  type SpawnedServer,
  killServer,
  spawnServer,
  waitForServer,
} from "./support/server_process.js";
import { removeTree } from "./support/fs_helpers.js";

const TEST_PORT = 4044;
const BASE_URL = `http://localhost:${String(TEST_PORT)}`;
const ACCEPT = "application/json, text/event-stream";
const EVENT_STREAM_ACCEPT = "text/event-stream";
const CONTENT_TYPE = "application/json";
const SESSION_ID_HEADER = "mcp-session-id";
const MCP_PATH = "/mcp";
const ADMIN_EVENTS_PATH = "/admin/events";
const TMP_PREFIX = "/tmp/tmc-stale-session-";

/// Expected HTTP status for unknown session IDs per MCP spec.
const SESSION_NOT_FOUND_STATUS = 404;

/// A session ID no server ever issued.
const STALE_SESSION_ID = "deadbeef-0000-0000-0000-000000000000";

/// A representative JSON-RPC request body for stale-session probes.
const TOOLS_CALL_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "status", arguments: {} },
});

let spawned: SpawnedServer | undefined;

const spawnTestServer = (): ChildProcess => {
  spawned = spawnServer({ port: TEST_PORT, tmpPrefix: TMP_PREFIX });
  return spawned.proc;
};

/** POSTs a JSON-RPC request carrying the stale session header. */
const postWithStaleSession = async (path: string): Promise<Response> =>
  fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": CONTENT_TYPE,
      Accept: ACCEPT,
      [SESSION_ID_HEADER]: STALE_SESSION_ID,
    },
    body: TOOLS_CALL_BODY,
  });

/** GETs a stream carrying the stale session header. */
const getWithStaleSession = async (path: string): Promise<Response> =>
  fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: {
      Accept: EVENT_STREAM_ACCEPT,
      [SESSION_ID_HEADER]: STALE_SESSION_ID,
    },
  });

/** Asserts the MCP-spec 404 for unknown session IDs. */
const expectSessionNotFound = (response: Response, context: string): void => {
  assert.strictEqual(
    response.status,
    SESSION_NOT_FOUND_STATUS,
    `Server MUST return 404 for unknown session IDs ` +
      `${context}. Got ${String(response.status)} instead.`,
  );
};

describe("stale session tests", () => {
  let serverProcess: ChildProcess;

  before(async () => {
    serverProcess = spawnTestServer();
    await waitForServer(BASE_URL);
  });

  after(() => {
    killServer(serverProcess);
    if (spawned !== undefined) {
      removeTree(spawned.workspace);
    }
  });

  it("POST /mcp with stale session ID returns 404", async () => {
    const response = await postWithStaleSession(MCP_PATH);
    expectSessionNotFound(response, "per MCP Streamable HTTP spec");
  });

  it("GET /mcp with stale session ID returns 404", async () => {
    const response = await getWithStaleSession(MCP_PATH);
    expectSessionNotFound(response, "on GET /mcp");
  });

  it("POST /admin/events with stale session ID returns 404", async () => {
    const response = await postWithStaleSession(ADMIN_EVENTS_PATH);
    expectSessionNotFound(response, "on POST /admin/events");
  });

  it("GET /admin/events with stale session ID returns 404", async () => {
    const response = await getWithStaleSession(ADMIN_EVENTS_PATH);
    expectSessionNotFound(response, "on GET /admin/events");
  });
});
