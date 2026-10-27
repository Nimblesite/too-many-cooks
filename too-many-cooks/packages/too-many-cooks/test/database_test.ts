/// Tests for database creation and lifecycle.

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
  ERR_LOCK_HELD,
  ERR_LOCK_EXPIRED,
  ERR_VALIDATION,
  ERR_DATABASE,
} from "too-many-cooks-core";
import { deleteDirIfExists, deleteIfExists } from "./support/fs_helpers.js";
import { freshTestDb } from "./support/db_fixture.js";

describe("database", () => {
  it("createDb succeeds with valid path", async () => {
    const testDbPath = ".test_create_db.db";
    const { db } = freshTestDb(testDbPath);
    await db.close();
    deleteIfExists(testDbPath);
  });

  it("createDb creates parent directory if needed", async () => {
    const testDir = ".test_nested_dir";
    const testDbPath = `${testDir}/subdir/data.db`;
    deleteDirIfExists(testDir);

    const { db } = freshTestDb(testDbPath);
    await db.close();
    deleteDirIfExists(testDir);
  });

  it("close succeeds", async () => {
    const testDbPath = ".test_close.db";
    const { db } = freshTestDb(testDbPath);

    const closeResult = await db.close();
    assert.strictEqual(closeResult.ok, true);

    deleteIfExists(testDbPath);
  });

  it("error codes are defined", () => {
    assert.strictEqual(ERR_NOT_FOUND, "NOT_FOUND");
    assert.strictEqual(ERR_UNAUTHORIZED, "UNAUTHORIZED");
    assert.strictEqual(ERR_LOCK_HELD, "LOCK_HELD");
    assert.strictEqual(ERR_LOCK_EXPIRED, "LOCK_EXPIRED");
    assert.strictEqual(ERR_VALIDATION, "VALIDATION");
    assert.strictEqual(ERR_DATABASE, "DATABASE");
  });
});
