/// [DB-ERROR-PATHS] Error and validation branches of src/db-sqlite.ts driven
/// black-box through the public createDb API: validation failures, NOT_FOUND /
/// LOCK_HELD outcomes, corrupt rows, the unwritable-path failure, and the full
/// ERR_DATABASE sweep after close() — every public method must fail with an
/// exact DbError, never throw.

import { describe, it } from "node:test";
import assert from "node:assert";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

import type { TooManyCooksDb } from "too-many-cooks-core";
import { createDataConfig } from "too-many-cooks-core";

import { createDb } from "../src/db-sqlite.js";
import { freshTestDb, registerAgent } from "./support/db_fixture.js";
import { deleteIfExists } from "./support/fs_helpers.js";

const TMP_PREFIX = "/tmp/tmc-db-errors-";
const CODE_DATABASE = "DATABASE";
const CODE_NOT_FOUND = "NOT_FOUND";
const CODE_VALIDATION = "VALIDATION";
const CODE_LOCK_HELD = "LOCK_HELD";
const CODE_UNAUTHORIZED = "UNAUTHORIZED";
const CLOSED_DB_SNIPPET = "database connection is not open";
const LOCK_PATH = "/cov/locked.ts";
const LOCK_TIMEOUT_MS = 600000;
const SMALL_MAX_MESSAGE = 8;
const DEFAULT_MAX_MESSAGE = 200;
const LONG_CONTENT = "123456789";
const AGENT_B = "err-agent-b";
const NAME_MAX = 50;

/** Assert a result is an error with the exact code and message. */
const expectError = (
  result: { ok: boolean; error?: unknown },
  code: string,
  message: string,
): void => {
  assert.strictEqual(result.ok, false, `expected error ${code}`);
  assert.deepStrictEqual(result.error, { code, message });
};

/** Assert a result failed with DATABASE containing `snippet`. */
const expectDatabaseError = (result: { ok: boolean; error?: unknown }, snippet: string): void => {
  if (result.ok) { assert.fail("expected DATABASE"); }
  const err = result.error;
  if (typeof err !== "object" || err === null || !("code" in err) || !("message" in err)) {
    assert.fail("malformed DbError");
  }
  assert.strictEqual(err.code, CODE_DATABASE);
  const message: unknown = err.message;
  if (typeof message !== "string" || !message.includes(snippet)) {
    assert.fail(`expected ${snippet} in ${String(message)}`);
  }
};

/** Fresh temp dir registered nowhere — callers rmSync in finally. */
const newTempDir = (): string => mkdtempSync(TMP_PREFIX);

/** Create a db with two registered agents at dbPath. */
const dbWithTwoAgents = async (dbPath: string): Promise<TooManyCooksDb> => {
  const fixture = freshTestDb(dbPath);
  await registerAgent(fixture.db, "err-agent-a");
  await registerAgent(fixture.db, AGENT_B);
  return fixture.db;
};

describe("db-sqlite validation and not-found branches", () => {
  it("rejects invalid registrations with exact messages", async () => {
    const dir = newTempDir();
    try {
      const db = await dbWithTwoAgents(join(dir, "data.db"));
      expectError(await db.register(""), CODE_VALIDATION, "Name must be 1-50 chars");
      expectError(
        await db.register("x".repeat(NAME_MAX + 1)),
        CODE_VALIDATION,
        "Name must be 1-50 chars",
      );
      expectError(
        await db.register("*"),
        CODE_VALIDATION,
        "Name '*' is reserved for broadcasts",
      );
      expectError(await db.register("err-agent-a"), CODE_VALIDATION, "Name already registered");
      expectError(
        await db.authenticate("err-agent-a", "wrong-key"),
        CODE_UNAUTHORIZED,
        "Invalid credentials",
      );
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("releaseLock and renewLock on an unlocked path are NOT_FOUND", async () => {
    const dir = newTempDir();
    try {
      const db = await dbWithTwoAgents(join(dir, "data.db"));
      const a = await registerAgent(db, "rel-a");
      expectError(
        await db.releaseLock("/no/such/lock", a.agentName, a.agentKey),
        CODE_NOT_FOUND,
        "Lock not held by you",
      );
      expectError(
        await db.renewLock("/no/such/lock", a.agentName, a.agentKey, LOCK_TIMEOUT_MS),
        CODE_NOT_FOUND,
        "Lock not held by you",
      );
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("forceReleaseLock distinguishes missing and unexpired locks", async () => {
    const dir = newTempDir();
    try {
      const db = await dbWithTwoAgents(join(dir, "data.db"));
      const a = await registerAgent(db, "force-a");
      const b = await registerAgent(db, "force-b");
      expectError(
        await db.forceReleaseLock(LOCK_PATH, a.agentName, a.agentKey),
        CODE_NOT_FOUND,
        "No lock exists",
      );
      const acquired = await db.acquireLock(LOCK_PATH, a.agentName, a.agentKey, "busy", LOCK_TIMEOUT_MS);
      if (!acquired.ok || !acquired.value.acquired) { assert.fail("acquire failed"); }
      expectError(
        await db.forceReleaseLock(LOCK_PATH, b.agentName, b.agentKey),
        CODE_LOCK_HELD,
        `Lock not expired, held by ${a.agentName}`,
      );
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("releaseLock and renewLock reject bad credentials first", async () => {
    const dir = newTempDir();
    try {
      const db = await dbWithTwoAgents(join(dir, "data.db"));
      const a = await registerAgent(db, "auth-a");
      expectError(
        await db.releaseLock(LOCK_PATH, a.agentName, "wrong-key"),
        CODE_UNAUTHORIZED,
        "Invalid credentials",
      );
      expectError(
        await db.renewLock(LOCK_PATH, a.agentName, "wrong-key", LOCK_TIMEOUT_MS),
        CODE_UNAUTHORIZED,
        "Invalid credentials",
      );
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("message length and markRead not-found paths", async () => {
    const dir = newTempDir();
    const dbPath = join(dir, "data.db");
    const config = createDataConfig({ dbPath, maxMessageLength: SMALL_MAX_MESSAGE });
    const created = createDb(config);
    if (!created.ok) { assert.fail("createDb failed"); }
    const db = created.value;
    try {
      const a = await registerAgent(db, "msg-a");
      const b = await registerAgent(db, "msg-b");
      expectError(
        await db.sendMessage(a.agentName, a.agentKey, b.agentName, LONG_CONTENT),
        CODE_VALIDATION,
        `Content exceeds ${String(SMALL_MAX_MESSAGE)} chars`,
      );
      expectError(
        await db.markRead("missing-msg", b.agentName, b.agentKey),
        CODE_NOT_FOUND,
        "Message not found",
      );
    } finally {
      await db.close();
      deleteIfExists(dbPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("admin validation and not-found paths", async () => {
    const dir = newTempDir();
    const dbPath = join(dir, "data.db");
    try {
      const db = await dbWithTwoAgents(dbPath);
      expectError(await db.adminDeleteLock("/none"), CODE_NOT_FOUND, "Lock not found");
      expectError(await db.adminDeleteAgent("ghost"), CODE_NOT_FOUND, "Agent not found");
      expectError(
        await db.adminSendMessage("sys", "x", "y".repeat(DEFAULT_MAX_MESSAGE + 1)),
        CODE_VALIDATION,
        `Content exceeds ${String(DEFAULT_MAX_MESSAGE)} chars`,
      );
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("activate/deactivate unknown agents is NOT_FOUND", async () => {
    const dir = newTempDir();
    const dbPath = join(dir, "data.db");
    try {
      const db = await dbWithTwoAgents(dbPath);
      expectError(await db.activate("ghost"), CODE_NOT_FOUND, "Agent not found");
      expectError(await db.deactivate("ghost"), CODE_NOT_FOUND, "Agent not found");
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("db-sqlite corrupt data branches", () => {
  const corruptRow = (
    dbPath: string,
    sql: string,
    param: string | number,
  ): void => {
    const probe = new Database(dbPath);
    probe.pragma("foreign_keys = OFF");
    probe.prepare(sql).run(param);
    probe.close();
  };

  it("lookupByKey reports DATABASE for a non-string agent_name", async () => {
    const dir = newTempDir();
    const dbPath = join(dir, "data.db");
    try {
      const db = await dbWithTwoAgents(dbPath);
      const a = await registerAgent(db, "corrupt-a");
      corruptRow(dbPath, "UPDATE identity SET agent_name = CAST(123 AS BLOB) WHERE agent_key = ?", a.agentKey);
      expectError(await db.lookupByKey(a.agentKey), CODE_DATABASE, "Missing agent_name");
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("markRead reports DATABASE_ERROR for a non-string to_agent", async () => {
    const dir = newTempDir();
    const dbPath = join(dir, "data.db");
    try {
      const db = await dbWithTwoAgents(dbPath);
      const a = await registerAgent(db, "corrupt-b");
      const b = await registerAgent(db, "corrupt-c");
      const sent = await db.sendMessage(a.agentName, a.agentKey, b.agentName, "hi");
      if (!sent.ok) { assert.fail("sendMessage failed"); }
      corruptRow(dbPath, "UPDATE messages SET to_agent = CAST(77 AS BLOB) WHERE id = ?", sent.value);
      expectError(
        await db.markRead(sent.value, b.agentName, b.agentKey),
        CODE_DATABASE,
        "Invalid to_agent in message",
      );
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("db-sqlite unwritable paths", () => {
  it("createDb fails when the db dir cannot be created", () => {
    const dir = newTempDir();
    try {
      const blocker = join(dir, "blocker");
      closeSync(openSync(blocker, "w"));
      const result = createDb(createDataConfig({ dbPath: join(blocker, "sub", "data.db") }));
      if (result.ok) { assert.fail("expected error"); }
      assert.ok(result.error.startsWith("Failed to create database directory"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("db-sqlite after close", () => {
  it("every public method returns DATABASE once the db is closed", async () => {
    const dir = newTempDir();
    const dbPath = join(dir, "data.db");
    try {
      const db = await dbWithTwoAgents(dbPath);
      const a = await registerAgent(db, "closed-a");
      assert.strictEqual((await db.close()).ok, true);

      // releaseLock/renewLock are asserted in their own test below.
      expectDatabaseError(await db.register("x"), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.authenticate(a.agentName, a.agentKey), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.lookupByKey(a.agentKey), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.listAgents(), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.activate(a.agentName), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.deactivate(a.agentName), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.deactivateAll(), CLOSED_DB_SNIPPET);
      expectDatabaseError(
        await db.acquireLock(LOCK_PATH, a.agentName, a.agentKey, "r", LOCK_TIMEOUT_MS),
        CLOSED_DB_SNIPPET,
      );
      expectDatabaseError(await db.forceReleaseLock(LOCK_PATH, a.agentName, a.agentKey), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.queryLock(LOCK_PATH), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.listLocks(), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.sendMessage(a.agentName, a.agentKey, AGENT_B, "hi"), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.getMessages(a.agentName, a.agentKey), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.getMessageOverview(a.agentName, 5), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.markRead("m", a.agentName, a.agentKey), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.listAllMessages(), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.updatePlan(a.agentName, a.agentKey, "g", "t"), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.getPlan(a.agentName), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.listPlans(), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.adminDeleteLock(LOCK_PATH), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.adminDeleteAgent(a.agentName), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.adminResetKey(a.agentName), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.adminSendMessage("sys", a.agentName, "hi"), CLOSED_DB_SNIPPET);
      expectDatabaseError(await db.adminReset(), CLOSED_DB_SNIPPET);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Regression: these two threw a raw TypeError after close() instead of
  // returning a DATABASE Result (statements prepared outside attempt()).
  it("releaseLock and renewLock return DATABASE (not throw) once the db is closed", async () => {
    const dir = newTempDir();
    const dbPath = join(dir, "data.db");
    try {
      const db = await dbWithTwoAgents(dbPath);
      const a = await registerAgent(db, "closed-lock");
      assert.strictEqual((await db.close()).ok, true);
      expectDatabaseError(await db.releaseLock(LOCK_PATH, a.agentName, a.agentKey), CLOSED_DB_SNIPPET);
      expectDatabaseError(
        await db.renewLock(LOCK_PATH, a.agentName, a.agentKey, LOCK_TIMEOUT_MS),
        CLOSED_DB_SNIPPET,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
