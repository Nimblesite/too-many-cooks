/// Tests for server.ts - createTooManyCooksServer.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createLoggerWithContext,
  createLoggingContext,
} from "../lib/src/logger.js";
import { createTooManyCooksServer } from "../lib/src/server.js";

describe("createTooManyCooksServer", () => {
  it("creates server with default config", () => {
    const result = createTooManyCooksServer();
    assert.strictEqual(result.ok, true);
  });

  it("creates server with custom config", () => {
    const config = {
      dbPath: `.test_server_${String(Date.now())}.db`,
      lockTimeoutMs: 5000,
      maxMessageLength: 100,
      maxPlanLength: 50,
    };
    const logger = createLoggerWithContext(createLoggingContext());
    const result = createTooManyCooksServer(config, logger);
    assert.strictEqual(result.ok, true);
  });

  it("fails with invalid db path", () => {
    const config = {
      dbPath: "/nonexistent/path/that/does/not/exist/db.sqlite",
      lockTimeoutMs: 5000,
      maxMessageLength: 100,
      maxPlanLength: 50,
    };
    const result = createTooManyCooksServer(config);
    assert.strictEqual(result.ok, false);
  });
});
