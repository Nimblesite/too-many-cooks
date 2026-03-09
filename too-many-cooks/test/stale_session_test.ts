/// Test: server returns 404 for stale/unknown MCP session IDs.
///
/// BUG: POST /mcp with an unknown mcp-session-id returns 400
/// instead of 404. Per the MCP Streamable HTTP spec, 404 tells
/// the client the session expired and it should re-initialize.
/// Returning 400 leaves clients stuck - they think the request
/// format is wrong rather than the session being stale.

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";

const TEST_PORT = 4044;
const BASE_URL = `http://localhost:${String(TEST_PORT)}`;
const ACCEPT = "application/json, text/event-stream";
const MCP_PATH = "/mcp";
const ADMIN_EVENTS_PATH = "/admin/events";

/// Expected HTTP status for unknown session IDs per MCP spec.
const SESSION_NOT_FOUND_STATUS = 404;

import { SERVER_BINARY, SERVER_NODE_ARGS } from "../lib/src/config.js";

let tmpWorkspace = "";

const spawnServer = (): ChildProcess => {
  tmpWorkspace = fs.mkdtempSync("/tmp/tmc-stale-session-");
  return spawn("node", [...SERVER_NODE_ARGS, SERVER_BINARY], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, TMC_PORT: String(TEST_PORT), TMC_WORKSPACE: tmpWorkspace },
  });
};

const killProcess = (proc: ChildProcess): void => {
  proc.kill();
};

const waitForServer = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE_URL}/admin/status`);
      if (r.ok) {return;}
    } catch {
      // Not ready yet
    }
    if (i === 29) {
      throw new Error("Server failed to start");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
};

describe("stale session tests", () => {
  let serverProcess: ChildProcess;

  before(async () => {
    serverProcess = spawnServer();
    await waitForServer();
  });

  after(() => {
    killProcess(serverProcess);
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  it("POST /mcp with stale session ID returns 404", async () => {
    const response = await fetch(`${BASE_URL}${MCP_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT,
        "mcp-session-id": "deadbeef-0000-0000-0000-000000000000",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "status", arguments: {} },
      }),
    });

    assert.strictEqual(
      response.status,
      SESSION_NOT_FOUND_STATUS,
      `Server MUST return 404 for unknown session IDs ` +
        `per MCP Streamable HTTP spec. Got ${String(response.status)} instead.`,
    );
  });

  it("GET /mcp with stale session ID returns 404", async () => {
    const response = await fetch(`${BASE_URL}${MCP_PATH}`, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        "mcp-session-id": "deadbeef-0000-0000-0000-000000000000",
      },
    });

    assert.strictEqual(
      response.status,
      SESSION_NOT_FOUND_STATUS,
      `Server MUST return 404 for unknown session IDs ` +
        `on GET /mcp. Got ${String(response.status)} instead.`,
    );
  });

  it("POST /admin/events with stale session ID returns 404", async () => {
    const response = await fetch(`${BASE_URL}${ADMIN_EVENTS_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT,
        "mcp-session-id": "deadbeef-0000-0000-0000-000000000000",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "status", arguments: {} },
      }),
    });

    assert.strictEqual(
      response.status,
      SESSION_NOT_FOUND_STATUS,
      `Server MUST return 404 for unknown session IDs ` +
        `on POST /admin/events. Got ${String(response.status)} instead.`,
    );
  });

  it("GET /admin/events with stale session ID returns 404", async () => {
    const response = await fetch(`${BASE_URL}${ADMIN_EVENTS_PATH}`, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        "mcp-session-id": "deadbeef-0000-0000-0000-000000000000",
      },
    });

    assert.strictEqual(
      response.status,
      SESSION_NOT_FOUND_STATUS,
      `Server MUST return 404 for unknown session IDs ` +
        `on GET /admin/events. Got ${String(response.status)} instead.`,
    );
  });
});
