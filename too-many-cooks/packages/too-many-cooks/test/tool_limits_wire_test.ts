/// [MCP-TOOL-LIMITS] Agents kept sending messages/plans over the length limit.
/// The limits must be impossible to miss on the WIRE (what an MCP client's
/// tools/list returns), must come from the configured limits rather than
/// hard-coded literals, and an over-long value must be rejected with an error
/// that states the actual length and the limit so the agent can fix it.

import { describe, it, before, after } from "node:test";
import assert from "node:assert";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  createDataConfig,
  createLoggerWithContext,
  createLoggingContext,
  createMcpServerForDb,
  type TooManyCooksDataConfig,
  type TooManyCooksDb,
} from "too-many-cooks-core";

import { createDb } from "../src/db-sqlite.js";
import { teardownTestDb } from "./support/db_fixture.js";
import { deleteIfExists } from "./support/fs_helpers.js";
import { getArrayField, getRecordField, getStringField, isRecord } from "./support/json.js";

const TEST_DB_PATH = ".test_tool_limits_wire.db";
/** Deliberately NOT the defaults (200/100): proves limits come from config. */
const MAX_MESSAGE = 50;
const MAX_PLAN = 30;
const OVER_MESSAGE = MAX_MESSAGE + 1;
const OVER_PLAN = MAX_PLAN + 1;
const FILL = "x";
const AGENT = "limits-agent";
const CLIENT = { name: "tool-limits-test", version: "1.0.0" };

type ToolInfo = { readonly description: string; readonly properties: Record<string, unknown> };

const toolInfo = (tools: readonly unknown[], name: string): ToolInfo => {
  const tool: unknown = tools.find((t: unknown): boolean => isRecord(t) && t.name === name);
  assert.ok(isRecord(tool), `tools/list must include ${name}`);
  return {
    description: getStringField(tool, "description"),
    properties: getRecordField(getRecordField(tool, "inputSchema"), "properties"),
  };
};

const maxLengthOf = (info: ToolInfo, field: string): unknown => {
  const prop: unknown = info.properties[field];
  assert.ok(isRecord(prop), `schema must declare ${field}`);
  return prop.maxLength;
};

/** Asserts an over-long value was rejected naming both length and limit. */
const assertRejectedWithLimit = (
  res: { readonly isError: boolean; readonly text: string },
  actual: number,
  limit: number,
): void => {
  assert.strictEqual(res.isError, true);
  assert.ok(res.text.includes(`${String(actual)} characters`), res.text);
  assert.ok(res.text.includes(`limit is ${String(limit)}`), res.text);
};

/** Text of a tools/call result, whether the SDK reports it as a result or throws. */
const callText = async (client: Client, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> => {
  try {
    const result: unknown = await client.callTool({ name, arguments: args });
    assert.ok(isRecord(result));
    const block: unknown = getArrayField(result, "content")[0];
    assert.ok(isRecord(block));
    return { isError: result.isError === true, text: getStringField(block, "text") };
  } catch (e: unknown) {
    return { isError: true, text: String(e) };
  }
};

describe("tool length limits on the wire", () => {
  let db: TooManyCooksDb | undefined;
  let client: Client | undefined;
  let tools: readonly unknown[] = [];

  before(async () => {
    // One config for db AND server, exactly as bin/server.ts wires them.
    deleteIfExists(TEST_DB_PATH);
    const config: TooManyCooksDataConfig = createDataConfig({
      dbPath: TEST_DB_PATH,
      maxMessageLength: MAX_MESSAGE,
      maxPlanLength: MAX_PLAN,
    });
    const opened = createDb(config);
    assert.ok(opened.ok);
    db = opened.value;
    const server = createMcpServerForDb(db, config, createLoggerWithContext(createLoggingContext()));
    assert.ok(server.ok);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.value.connect(serverTransport);
    client = new Client(CLIENT);
    await client.connect(clientTransport);
    tools = (await client.listTools()).tools;
    const reg = await callText(client, "register", { name: AGENT });
    assert.strictEqual(reg.isError, false, reg.text);
  });

  after(async () => {
    await client?.close();
    await teardownTestDb(db, TEST_DB_PATH);
  });

  /** Asserts `tool`'s wire description states the configured `limit`. */
  const assertDescriptionStatesLimit = (tool: string, limit: number): void => {
    const description: string = toolInfo(tools, tool).description;
    assert.ok(description.includes(`${String(limit)} characters`), description);
  };

  /** The connected client, asserted to exist. */
  const requireClient = (): Client => {
    assert.ok(client !== undefined, "client not connected");
    return client;
  };

  it("message tool description states the configured character limit", () => {
    assertDescriptionStatesLimit("message", MAX_MESSAGE);
  });

  it("message content schema maxLength is the configured limit", () => {
    assert.strictEqual(maxLengthOf(toolInfo(tools, "message"), "content"), MAX_MESSAGE);
  });

  it("plan tool description states the configured character limit", () => {
    assertDescriptionStatesLimit("plan", MAX_PLAN);
  });

  it("plan goal and current_task schema maxLength are the configured limit", () => {
    const info: ToolInfo = toolInfo(tools, "plan");
    assert.strictEqual(maxLengthOf(info, "goal"), MAX_PLAN);
    assert.strictEqual(maxLengthOf(info, "current_task"), MAX_PLAN);
  });

  it("a message at exactly the limit is accepted", async () => {
    const res = await callText(requireClient(), "message", { action: "send", to_agent: "*", content: FILL.repeat(MAX_MESSAGE) });
    assert.strictEqual(res.isError, false, res.text);
  });

  it("an over-long message is rejected with its length and the limit", async () => {
    const res = await callText(requireClient(), "message", { action: "send", to_agent: "*", content: FILL.repeat(OVER_MESSAGE) });
    assertRejectedWithLimit(res, OVER_MESSAGE, MAX_MESSAGE);
  });

  it("an over-long plan goal is rejected with its length and the limit", async () => {
    const res = await callText(requireClient(), "plan", { action: "update", goal: FILL.repeat(OVER_PLAN), current_task: FILL });
    assertRejectedWithLimit(res, OVER_PLAN, MAX_PLAN);
  });
});
