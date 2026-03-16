/// Tests for configuration utilities.

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  resolveDbPath,
  createDataConfig,
  createDataConfigFromWorkspace,
  defaultConfig,
  getWorkspaceFolder,
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_MAX_MESSAGE_LENGTH,
  DEFAULT_MAX_PLAN_LENGTH,
} from "@too-many-cooks/core";

describe("config", () => {
  it("resolveDbPath returns correct path", () => {
    const path = resolveDbPath("/workspace/project");
    assert.strictEqual(path, "/workspace/project/.too_many_cooks/data.db");
  });

  it("createDataConfig uses provided values", () => {
    const config = createDataConfig({
      dbPath: "/custom/path.db",
      lockTimeoutMs: 30000,
      maxMessageLength: 500,
      maxPlanLength: 200,
    });
    assert.strictEqual(config.dbPath, "/custom/path.db");
    assert.strictEqual(config.lockTimeoutMs, 30000);
    assert.strictEqual(config.maxMessageLength, 500);
    assert.strictEqual(config.maxPlanLength, 200);
  });

  it("createDataConfig uses defaults", () => {
    const config = createDataConfig({ dbPath: "/path.db" });
    assert.strictEqual(config.dbPath, "/path.db");
    assert.strictEqual(config.lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
    assert.strictEqual(config.maxMessageLength, DEFAULT_MAX_MESSAGE_LENGTH);
    assert.strictEqual(config.maxPlanLength, DEFAULT_MAX_PLAN_LENGTH);
  });

  it("createDataConfigFromWorkspace creates config with resolved path", () => {
    const config = createDataConfigFromWorkspace("/my/workspace");
    assert.strictEqual(config.dbPath, "/my/workspace/.too_many_cooks/data.db");
    assert.strictEqual(config.lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
    assert.strictEqual(config.maxMessageLength, DEFAULT_MAX_MESSAGE_LENGTH);
    assert.strictEqual(config.maxPlanLength, DEFAULT_MAX_PLAN_LENGTH);
  });

  it("default constants have expected values", () => {
    assert.strictEqual(DEFAULT_LOCK_TIMEOUT_MS, 600000);
    assert.strictEqual(DEFAULT_MAX_MESSAGE_LENGTH, 200);
    assert.strictEqual(DEFAULT_MAX_PLAN_LENGTH, 100);
  });

  it("getWorkspaceFolder returns a non-empty string", () => {
    const folder = getWorkspaceFolder();
    assert.ok(folder.length > 0);
  });

  it("defaultConfig uses getWorkspaceFolder for dbPath", () => {
    const expected = resolveDbPath(getWorkspaceFolder());
    assert.strictEqual(defaultConfig.dbPath, expected);
  });

  it("defaultConfig dbPath always ends with .too_many_cooks/data.db", () => {
    assert.ok(defaultConfig.dbPath.includes(".too_many_cooks/data.db"));
  });

  it("defaultConfig uses default timeout and limits", () => {
    assert.strictEqual(defaultConfig.lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
    assert.strictEqual(defaultConfig.maxMessageLength, DEFAULT_MAX_MESSAGE_LENGTH);
    assert.strictEqual(defaultConfig.maxPlanLength, DEFAULT_MAX_PLAN_LENGTH);
  });

  it("defaultConfig dbPath matches createDataConfigFromWorkspace", () => {
    const fromWorkspace = createDataConfigFromWorkspace(getWorkspaceFolder());
    assert.strictEqual(defaultConfig.dbPath, fromWorkspace.dbPath);
  });
});
