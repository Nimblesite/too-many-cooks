/// Integration tests — REGRESSION TESTS: missing parameter validation.
/// Tools must return proper errors instead of crashing.

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  assertToolCallFails,
  bindIntegrationSuite,
  firstContentText,
} from "./support/integration_server.js";

const TEST_PORT = 4057;
const TMP_PREFIX = "/tmp/tmc-integration-validation-";
const TOOLS_WITHOUT_ACTION: readonly string[] = ["lock", "message", "plan"];

describe("Too Many Cooks MCP Server Integration", () => {
  // Server for the file; DB reset + fresh MCP client for each test
  const suite = bindIntegrationSuite(TEST_PORT, TMP_PREFIX);

  it("register without name or key returns error", async () => {
    const client = suite.client();
    const result = await assertToolCallFails(client, "register", {});
    assert.ok(firstContentText(result).includes("missing_parameter"));
  });

  for (const tool of TOOLS_WITHOUT_ACTION) {
    it(`${tool} without action returns error`, async () => {
      const client = suite.client();
      await assertToolCallFails(client, tool, {});
    });
  }

  it("message without registration returns not_registered", async () => {
    const client = suite.client();
    // No register call - session is empty, no hidden args either
    const result = await assertToolCallFails(client, "message", { action: "get" });
    assert.ok(firstContentText(result).includes("not_registered"));
  });
});
