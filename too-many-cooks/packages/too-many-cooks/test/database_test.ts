/// Tests for database creation and lifecycle.

import { describe, it } from "node:test";
import assert from "node:assert";

import fs from "node:fs";

import {
  createDataConfig,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
  ERR_LOCK_HELD,
  ERR_LOCK_EXPIRED,
  ERR_VALIDATION,
  ERR_DATABASE,
} from "too-many-cooks-core";
import { createDb } from "../src/db-sqlite.js";

const deleteIfExists = (path: string): void => {
  try {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  } catch {
    // ignore
  }
};

const deleteDirIfExists = (path: string): void => {
  try {
    if (fs.existsSync(path)) {
      fs.rmSync(path, { recursive: true });
    }
  } catch {
    // ignore
  }
};

describe("database", () => {
  it("createDb succeeds with valid path", async () => {
    const testDbPath = ".test_create_db.db" as const;
    deleteIfExists(testDbPath);

    const config = createDataConfig({ dbPath: testDbPath });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);

    if (result.ok) {
      await result.value.close();
    }
    deleteIfExists(testDbPath);
  });

  it("createDb creates parent directory if needed", async () => {
    const testDir = ".test_nested_dir" as const;
    const testDbPath = `${testDir}/subdir/data.db`;
    deleteDirIfExists(testDir);

    const config = createDataConfig({ dbPath: testDbPath });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);

    if (result.ok) {
      await result.value.close();
    }
    deleteDirIfExists(testDir);
  });

  it("close succeeds", async () => {
    const testDbPath = ".test_close.db" as const;
    deleteIfExists(testDbPath);

    const config = createDataConfig({ dbPath: testDbPath });
    const createResult = createDb(config);
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) {return;}
    const db = createResult.value;

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
