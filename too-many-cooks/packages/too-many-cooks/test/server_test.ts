/// Tests for server.ts - createTooManyCooksServer.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createLoggerWithContext,
  createLoggingContext,
} from "too-many-cooks-core";
import { createTooManyCooksServer } from "../src/server.js";

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
    const chunks: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    const origStdout = process.stdout.write.bind(process.stdout);
    process.stderr.write = ((chunk: unknown): boolean => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = ((chunk: unknown): boolean => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const config = {
        dbPath: "/nonexistent/path/that/does/not/exist/db.sqlite",
        lockTimeoutMs: 5000,
        maxMessageLength: 100,
        maxPlanLength: 50,
      };
      const result = createTooManyCooksServer(config);
      assert.strictEqual(result.ok, false);

      const captured: string = chunks.join("");
      const leaked: readonly string[] = captured
        .split("\n")
        .map((s: string): string => s.trim())
        .filter((s: string): boolean => /\[(ERROR|FATAL)\]/.test(s));
      assert.deepStrictEqual(
        leaked,
        [],
        `createTooManyCooksServer leaked [ERROR]/[FATAL] log lines to stdio. They MUST be captured by a caller-provided logger:\n${leaked.join("\n")}`,
      );
    } finally {
      process.stderr.write = origStderr;
      process.stdout.write = origStdout;
    }
  });
});
