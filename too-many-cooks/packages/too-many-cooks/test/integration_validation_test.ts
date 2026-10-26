/// Integration tests — REGRESSION TESTS: missing parameter validation.
/// Tools must return proper errors instead of crashing.

import { describe, it } from "node:test";
import assert from "node:assert";

import { assertDefined } from "./support/assertions.js";
import { getRecordArrayField, getStringField } from "./support/json.js";
import {
  bindIntegrationLifecycle,
  createIntegrationServer,
} from "./support/integration_server.js";

const TEST_PORT = 4057;
const TMP_PREFIX = "/tmp/tmc-integration-validation-";

describe("Too Many Cooks MCP Server Integration", () => {
  // Server for the file; DB reset + fresh MCP client for each test
  const suite = bindIntegrationLifecycle(
    createIntegrationServer(TEST_PORT, TMP_PREFIX),
  );

  it("register without name or key returns error", async () => {
    const client = suite.client();
    const result = await client.callToolRaw("register", {});
    assert.strictEqual(result.isError, true);
    const content = getRecordArrayField(result, "content")[0];
    assertDefined(content, "error content block");
    const text = getStringField(content, "text");
    assert.ok(text.includes("missing_parameter"));
  });

  it("lock without action returns error", async () => {
    const client = suite.client();
    const result = await client.callToolRaw("lock", {});
    assert.strictEqual(result.isError, true);
  });

  it("message without action returns error", async () => {
    const client = suite.client();
    const result = await client.callToolRaw("message", {});
    assert.strictEqual(result.isError, true);
  });

  it("message without registration returns not_registered", async () => {
    const client = suite.client();
    // No register call - session is empty, no hidden args either
    const result = await client.callToolRaw("message", { action: "get" });
    assert.strictEqual(result.isError, true);
    const content = getRecordArrayField(result, "content")[0];
    assertDefined(content, "error content block");
    const text = getStringField(content, "text");
    assert.ok(text.includes("not_registered"));
  });

  it("plan without action returns error", async () => {
    const client = suite.client();
    const result = await client.callToolRaw("plan", {});
    assert.strictEqual(result.isError, true);
  });
});
