/// Integration tests — REGRESSION TESTS: missing parameter validation.
/// Tools must return proper errors instead of crashing.

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  bindIntegrationLifecycle,
  createIntegrationServer,
  firstContentText,
} from "./support/integration_server.js";

const TEST_PORT = 4057;
const TMP_PREFIX = "/tmp/tmc-integration-validation-";
const TOOLS_WITHOUT_ACTION: readonly string[] = ["lock", "message", "plan"];

describe("Too Many Cooks MCP Server Integration", () => {
  // Server for the file; DB reset + fresh MCP client for each test
  const suite = bindIntegrationLifecycle(
    createIntegrationServer(TEST_PORT, TMP_PREFIX),
  );

  it("register without name or key returns error", async () => {
    const client = suite.client();
    const result = await client.callToolRaw("register", {});
    assert.strictEqual(result.isError, true);
    assert.ok(firstContentText(result).includes("missing_parameter"));
  });

  for (const tool of TOOLS_WITHOUT_ACTION) {
    it(`${tool} without action returns error`, async () => {
      const client = suite.client();
      const result = await client.callToolRaw(tool, {});
      assert.strictEqual(result.isError, true);
    });
  }

  it("message without registration returns not_registered", async () => {
    const client = suite.client();
    // No register call - session is empty, no hidden args either
    const result = await client.callToolRaw("message", { action: "get" });
    assert.strictEqual(result.isError, true);
    assert.ok(firstContentText(result).includes("not_registered"));
  });
});
