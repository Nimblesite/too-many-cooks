/// Contract test for MCP serverInfo.version.
///
/// Connects the server over an in-memory transport and reads the
/// version it reports during the initialize handshake — the same
/// value clients see on the wire.

import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  createLoggerWithContext,
  createLoggingContext,
  createMcpServerForDb,
  type TooManyCooksDataConfig,
} from "too-many-cooks-core";

import { freshTestDb, teardownTestDb } from "./support/db_fixture.js";
import { getStringField, parseJsonRecord } from "./support/json.js";

const TEST_DB_PATH = ".test_server_version_contract.db";
const MEMORY_DB_PATH = ":memory:";
const LOCK_TIMEOUT_MS = 5000;
const MAX_MESSAGE_LENGTH = 200;
const MAX_PLAN_LENGTH = 100;
const CLIENT_NAME = "version-contract-test";
const CLIENT_VERSION = "1.0.0";
const EXPECTED_PACKAGE_VERSION = "0.0.0-dev";

const testDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(testDir, "..", "package.json");
const packageVersion = getStringField(
  parseJsonRecord(readFileSync(packageJsonPath, "utf8")),
  "version",
);

const startClient = async (
  server: Awaited<ReturnType<typeof createMcpServerForDb>>,
): Promise<Client> => {
  assert.equal(server.ok, true);
  if (!server.ok) { throw new Error("expected ok"); }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.value.connect(serverTransport);
  const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
  await client.connect(clientTransport);
  return client;
};

describe("MCP server version contract", () => {
  it("serverInfo.version matches the npm package version", async () => {
    const fixture = freshTestDb(TEST_DB_PATH);
    const config: TooManyCooksDataConfig = {
      dbPath: MEMORY_DB_PATH,
      lockTimeoutMs: LOCK_TIMEOUT_MS,
      maxMessageLength: MAX_MESSAGE_LENGTH,
      maxPlanLength: MAX_PLAN_LENGTH,
    };
    const result = createMcpServerForDb(
      fixture.db,
      config,
      createLoggerWithContext(createLoggingContext()),
    );
    const client = await startClient(result);
    try {
      const serverInfo = client.getServerVersion();
      assert.ok(serverInfo !== undefined, "initialize must report server info");
      assert.equal(serverInfo.version, packageVersion);
      assert.equal(packageVersion, EXPECTED_PACKAGE_VERSION);
    } finally {
      await client.close();
      await teardownTestDb(fixture.db, TEST_DB_PATH);
    }
  });
});
