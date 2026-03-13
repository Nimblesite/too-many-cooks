/// Integration tests for cloud proxy configuration parsing.

import { strict as assert } from "node:assert";
import test from "node:test";

import { parseConfig } from "../src/config.js";

/** Valid test environment. */
const VALID_ENV = {
  TMC_API_KEY: "tmc_sk_test123",
  TMC_WORKSPACE_ID: "550e8400-e29b-41d4-a716-446655440000",
  TMC_WORKSPACE_SECRET: "my-secret",
};

/** Custom API URL for testing. */
const CUSTOM_API_URL = "https://custom.supabase.co/functions/v1/tmc-api";

/** Expected key version. */
const EXPECTED_VERSION = 1;

test("parseConfig succeeds with all required env vars", () => {
  const result = parseConfig(VALID_ENV);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.apiKey, VALID_ENV.TMC_API_KEY);
    assert.equal(result.value.workspaceId, VALID_ENV.TMC_WORKSPACE_ID);
    assert.equal(result.value.keychain.length, 1);
    assert.equal(result.value.currentKey.version, EXPECTED_VERSION);
  }
});

test("parseConfig fails when TMC_API_KEY is missing", () => {
  const result = parseConfig({
    TMC_WORKSPACE_ID: VALID_ENV.TMC_WORKSPACE_ID,
    TMC_WORKSPACE_SECRET: VALID_ENV.TMC_WORKSPACE_SECRET,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /TMC_API_KEY/u);
  }
});

test("parseConfig fails when TMC_WORKSPACE_ID is missing", () => {
  const result = parseConfig({
    TMC_API_KEY: VALID_ENV.TMC_API_KEY,
    TMC_WORKSPACE_SECRET: VALID_ENV.TMC_WORKSPACE_SECRET,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /TMC_WORKSPACE_ID/u);
  }
});

test("parseConfig fails when TMC_WORKSPACE_SECRET is missing", () => {
  const result = parseConfig({
    TMC_API_KEY: VALID_ENV.TMC_API_KEY,
    TMC_WORKSPACE_ID: VALID_ENV.TMC_WORKSPACE_ID,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /TMC_WORKSPACE_SECRET/u);
  }
});

test("parseConfig uses custom API URL when provided", () => {
  const result = parseConfig({
    ...VALID_ENV,
    TMC_API_URL: CUSTOM_API_URL,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.apiUrl, CUSTOM_API_URL);
  }
});

test("parseConfig uses default API URL when not provided", () => {
  const result = parseConfig(VALID_ENV);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.value.apiUrl.length > 0);
  }
});

test("parseConfig builds keychain with previous secret", () => {
  const result = parseConfig({
    ...VALID_ENV,
    TMC_WORKSPACE_SECRET_V1: "old-secret",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    const expectedKeychainLength = 2;
    assert.equal(result.value.keychain.length, expectedKeychainLength);
  }
});

test("parseConfig fails when TMC_API_KEY is empty string", () => {
  const result = parseConfig({
    ...VALID_ENV,
    TMC_API_KEY: "",
  });
  assert.equal(result.ok, false);
});

test("same passphrase and workspace produce same key", () => {
  const result1 = parseConfig(VALID_ENV);
  const result2 = parseConfig(VALID_ENV);
  assert.equal(result1.ok, true);
  assert.equal(result2.ok, true);
  if (result1.ok && result2.ok) {
    assert.deepEqual(result1.value.currentKey.key, result2.value.currentKey.key);
  }
});
