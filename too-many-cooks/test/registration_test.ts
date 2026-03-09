/// Tests for agent registration.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import {
  type TooManyCooksDb,
  createDb,
  createDataConfig,
  ERR_VALIDATION,
} from "../lib/src/data/data.js";

const TEST_DB_PATH = ".test_registration.db";

const deleteIfExists = (path: string): void => {
  try {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  } catch {
    // ignore
  }
};

describe("registration", () => {
  let db: TooManyCooksDb | undefined;

  beforeEach(() => {
    deleteIfExists(TEST_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    db = result.value;
  });

  afterEach(() => {
    db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  it("register creates agent with key", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const result = db.register("test-agent");
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const reg = result.value;
    assert.strictEqual(reg.agentName, "test-agent");
    assert.strictEqual(reg.agentKey.length, 64);
  });

  it("register fails for duplicate name", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    db.register("duplicate-agent");
    const result = db.register("duplicate-agent");
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_VALIDATION);
    assert.ok(result.error.message.includes("already registered"));
  });

  it("register fails for empty name", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const result = db.register("");
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_VALIDATION);
    assert.ok(result.error.message.includes("1-50"));
  });

  it("register fails for name over 50 chars", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const result = db.register("a".repeat(51));
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_VALIDATION);
    assert.ok(result.error.message.includes("1-50"));
  });

  it("register accepts name of exactly 50 chars", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const result = db.register("a".repeat(50));
    assert.strictEqual(result.ok, true);
  });

  it("listAgents returns registered agents", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    db.register("agent1");
    db.register("agent2");
    const result = db.listAgents();
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const agents = result.value;
    assert.strictEqual(agents.length, 2);
    assert.deepStrictEqual(
      new Set(agents.map((a) => a.agentName)),
      new Set(["agent1", "agent2"]),
    );
  });
});
