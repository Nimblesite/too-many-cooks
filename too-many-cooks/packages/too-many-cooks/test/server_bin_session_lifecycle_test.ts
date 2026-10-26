/// [SESSION-LIFECYCLE] MCP + admin Streamable HTTP session edges on the REAL
/// spawned bin (bin/server.ts): initialize handshake, missing/unknown session
/// ids (exact JSON-RPC error bodies), and DELETE-terminates-session — which is
/// what exercises the transport onclose cleanup paths (session map removal).
///
/// Shared server lifecycle + MCP HTTP constants/parsing come from
/// test/support/server_process.ts and test/support/mcp_http.ts.

import { after, before, describe, it } from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";

import {
  ACCEPT_STREAMABLE,
  ADMIN_EVENTS_PATH,
  JSONRPC_VERSION,
  MCP_PATH,
  MCP_PROTOCOL_VERSION,
  SESSION_ID_HEADER,
  parseMcpPayload,
} from "./support/mcp_http.js";
import { buildBaseUrl, spawnServer, waitForServer, type SpawnedServer } from "./support/server_process.js";
import { isRecord } from "../src/json-guards.js";

const PORT = 4094;
const BASE = buildBaseUrl(PORT);
const BAD_REQUEST_BODY =
  '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request"},"id":null}';
const SESSION_NOT_FOUND_BODY =
  '{"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"},"id":null}';
const MISSING_SESSION_TEXT = "Missing session ID";
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const STATUS_OK = 200;
const SERVER_NAME = "too-many-cooks";
const SERVER_VERSION = "0.5.0";
const AGENT_NAME = "cov-session-agent";
const CONTENT_TYPE_JSON = "application/json";
const READY_POLLS = 150;
const POLL_INTERVAL_MS = 100;

let server: SpawnedServer | undefined;

/** POST a JSON-RPC message, optionally with a session id header. */
const post = async (path: string, body: unknown, sessionId?: string): Promise<Response> => {
  const headers: Record<string, string> = { "Content-Type": CONTENT_TYPE_JSON, Accept: ACCEPT_STREAMABLE };
  if (sessionId !== undefined) { headers[SESSION_ID_HEADER] = sessionId; }
  return fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
};

const initializeMessage = (id: number): unknown => ({
  jsonrpc: JSONRPC_VERSION,
  id,
  method: "initialize",
  params: {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "cov-session-test", version: "1.0.0" },
  },
});

/** Tool-call result fields we assert on. */
type McpResult = {
  readonly serverInfo?: unknown;
  readonly isError?: unknown;
  readonly content?: readonly { readonly text?: unknown }[];
};

/** Narrow a parsed MCP payload to its result object. */
const resultOf = (val: Record<string, unknown>): McpResult => {
  const result: unknown = val.result;
  if (!isRecord(result)) { assert.fail(`no result: ${JSON.stringify(val)}`); }
  const content: readonly { readonly text?: unknown }[] | undefined = Array.isArray(result.content)
    ? result.content.map((item: unknown): { readonly text?: unknown } =>
        isRecord(item) && "text" in item ? { text: item.text } : {})
    : undefined;
  return {
    serverInfo: result.serverInfo,
    isError: result.isError,
    ...(content === undefined ? {} : { content }),
  };
};

/** Assert an exact HTTP status code and text body. */
const expectResponse = async (response: Response, status: number, body: string): Promise<void> => {
  assert.strictEqual(response.status, status);
  assert.strictEqual(await response.text(), body);
};

/** Initialize an MCP session and return its id. */
const openMcpSession = async (): Promise<string> => {
  const response = await post(MCP_PATH, initializeMessage(1));
  assert.strictEqual(response.status, STATUS_OK);
  const sessionId = response.headers.get(SESSION_ID_HEADER);
  if (sessionId === null) { assert.fail("no mcp-session-id header"); }
  const result = resultOf(parseMcpPayload(await response.text()));
  assert.deepStrictEqual(result.serverInfo, { name: SERVER_NAME, version: SERVER_VERSION });
  return sessionId;
};

before(async () => {
  server = spawnServer({ port: PORT, tmpPrefix: "/tmp/tmc-session-cov-", captureStderr: true });
  await waitForServer(BASE, READY_POLLS, POLL_INTERVAL_MS);
});

after(() => {
  server?.proc.kill();
  if (server !== undefined) { rmSync(server.workspace, { recursive: true, force: true }); }
});

describe("MCP session HTTP edges", () => {
  it("rejects non-initialize POSTs without a session id", async () => {
    await expectResponse(
      await post(MCP_PATH, { jsonrpc: JSONRPC_VERSION, id: 9, method: "tools/list" }),
      HTTP_BAD_REQUEST,
      BAD_REQUEST_BODY,
    );
  });

  it("rejects GET without a session id", async () => {
    await expectResponse(
      await fetch(`${BASE}${MCP_PATH}`, { headers: { Accept: ACCEPT_STREAMABLE } }),
      HTTP_BAD_REQUEST,
      MISSING_SESSION_TEXT,
    );
  });

  it("rejects POST and GET with an unknown session id", async () => {
    await expectResponse(
      await post(MCP_PATH, initializeMessage(2), "no-such-session"),
      HTTP_NOT_FOUND,
      SESSION_NOT_FOUND_BODY,
    );
    await expectResponse(
      await fetch(`${BASE}${MCP_PATH}`, {
        headers: { Accept: ACCEPT_STREAMABLE, [SESSION_ID_HEADER]: "no-such-session" },
      }),
      HTTP_NOT_FOUND,
      SESSION_NOT_FOUND_BODY,
    );
  });

  it("initialize + tools/call over a session, then DELETE cleans it up", async () => {
    const sessionId = await openMcpSession();

    const call = await post(MCP_PATH, {
      jsonrpc: JSONRPC_VERSION,
      id: 3,
      method: "tools/call",
      params: { name: "register", arguments: { name: AGENT_NAME } },
    }, sessionId);
    assert.strictEqual(call.status, STATUS_OK);
    const result = resultOf(parseMcpPayload(await call.text()));
    assert.strictEqual(result.isError, false);
    const toolText: unknown = result.content?.[0]?.text;
    if (typeof toolText !== "string") { assert.fail("no tool content text"); }
    assert.ok(toolText.includes(AGENT_NAME), toolText);

    const deleted = await fetch(`${BASE}${MCP_PATH}`, {
      method: "DELETE",
      headers: { [SESSION_ID_HEADER]: sessionId },
    });
    assert.strictEqual(deleted.status, STATUS_OK);

    const afterDelete = await fetch(`${BASE}${MCP_PATH}`, {
      headers: { Accept: ACCEPT_STREAMABLE, [SESSION_ID_HEADER]: sessionId },
    });
    await expectResponse(afterDelete, HTTP_NOT_FOUND, SESSION_NOT_FOUND_BODY);
  });
});

describe("admin events session HTTP edges", () => {
  it("rejects unknown-session and no-session requests with exact bodies", async () => {
    await expectResponse(
      await post(ADMIN_EVENTS_PATH, { jsonrpc: JSONRPC_VERSION, id: 1, method: "ping" }),
      HTTP_BAD_REQUEST,
      BAD_REQUEST_BODY,
    );
    await expectResponse(
      await post(ADMIN_EVENTS_PATH, initializeMessage(2), "no-such-session"),
      HTTP_NOT_FOUND,
      SESSION_NOT_FOUND_BODY,
    );
    await expectResponse(
      await fetch(`${BASE}${ADMIN_EVENTS_PATH}`, { headers: { Accept: ACCEPT_STREAMABLE } }),
      HTTP_BAD_REQUEST,
      MISSING_SESSION_TEXT,
    );
    await expectResponse(
      await fetch(`${BASE}${ADMIN_EVENTS_PATH}`, {
        headers: { Accept: ACCEPT_STREAMABLE, [SESSION_ID_HEADER]: "no-such-session" },
      }),
      HTTP_NOT_FOUND,
      SESSION_NOT_FOUND_BODY,
    );
  });

  it("initialize an admin session, then DELETE removes it", async () => {
    const response = await post(ADMIN_EVENTS_PATH, initializeMessage(3));
    assert.strictEqual(response.status, STATUS_OK);
    const sessionId = response.headers.get(SESSION_ID_HEADER);
    if (sessionId === null) { assert.fail("no admin session id header"); }

    const deleted = await fetch(`${BASE}${ADMIN_EVENTS_PATH}`, {
      method: "DELETE",
      headers: { [SESSION_ID_HEADER]: sessionId },
    });
    assert.strictEqual(deleted.status, STATUS_OK);

    const afterDelete = await post(ADMIN_EVENTS_PATH, initializeMessage(4), sessionId);
    await expectResponse(afterDelete, HTTP_NOT_FOUND, SESSION_NOT_FOUND_BODY);
  });
});
