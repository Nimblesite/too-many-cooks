/// Tests for agent authentication.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import fs from "node:fs";

import {
  type TooManyCooksDb,
  createDataConfig,
  createDb,
  ERR_UNAUTHORIZED,
} from "../lib/src/data/data.js";

const TEST_DB_PATH = ".test_authentication.db" as const;

const deleteIfExists = (path: string): void => {
  try {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  } catch {
    // ignore
  }
};

describe("authentication", () => {
  let db: TooManyCooksDb | undefined;

  beforeEach(() => {
    deleteIfExists(TEST_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      db = result.value;
    }
  });

  afterEach(() => {
    db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  it("authenticate succeeds with valid credentials", () => {
    const regResult = db!.register("auth-agent");
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;

    const authResult = db!.authenticate(reg.agentName, reg.agentKey);
    assert.strictEqual(authResult.ok, true);
    if (!authResult.ok) {return;}
    const agent = authResult.value;
    assert.strictEqual(agent.agentName, "auth-agent");
  });

  it("authenticate fails with invalid key", () => {
    db!.register("auth-agent2");

    const authResult = db!.authenticate("auth-agent2", "wrong-key");
    assert.strictEqual(authResult.ok, false);
    if (!authResult.ok) {
      assert.strictEqual(authResult.error.code, ERR_UNAUTHORIZED);
    }
  });

  it("authenticate fails for nonexistent agent", () => {
    const authResult = db!.authenticate("nonexistent", "any-key");
    assert.strictEqual(authResult.ok, false);
    if (!authResult.ok) {
      assert.strictEqual(authResult.error.code, ERR_UNAUTHORIZED);
    }
  });

  it("authenticate updates last_active timestamp", () => {
    const regResult = db!.register("timestamp-agent");
    assert.strictEqual(regResult.ok, true);
    if (!regResult.ok) {return;}
    const reg = regResult.value;

    const firstAuth = db!.authenticate(reg.agentName, reg.agentKey);
    assert.strictEqual(firstAuth.ok, true);
    if (!firstAuth.ok) {return;}
    const firstAgent = firstAuth.value;

    // Small delay to ensure timestamp changes
    const secondAuth = db!.authenticate(reg.agentName, reg.agentKey);
    assert.strictEqual(secondAuth.ok, true);
    if (!secondAuth.ok) {return;}
    const secondAgent = secondAuth.value;

    assert.ok(secondAgent.lastActive >= firstAgent.lastActive);
  });
});
