/// Contract test for MCP serverInfo.version.

import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLoggerWithContext,
  createLoggingContext,
  createMcpServerForDb,
  type TooManyCooksDataConfig,
} from "../../core/src/index.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(testDir, "..", "package.json");
const packageVersion = (JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string }).version;

type CreatedServer = {
  readonly server: {
    readonly _serverInfo?: {
      readonly version?: string;
    };
  };
};

describe("MCP server version contract", () => {
  it("serverInfo.version matches the npm package version", () => {
    const config: TooManyCooksDataConfig = {
      dbPath: ":memory:",
      lockTimeoutMs: 5000,
      maxMessageLength: 200,
      maxPlanLength: 100,
    };
    const result = createMcpServerForDb(
      {},
      config,
      createLoggerWithContext(createLoggingContext()),
    );

    assert.equal(result.ok, true);
    const server = result.value as unknown as CreatedServer;
    assert.equal(server.server._serverInfo?.version, packageVersion);
    assert.equal(packageVersion, "0.5.0");
  });
});
