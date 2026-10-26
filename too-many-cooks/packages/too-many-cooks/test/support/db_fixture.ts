/// Shared SQLite test-db fixture: fresh config + db per test, with
/// teardown and agent registration ([DEDUP-DESLOP]).
///
/// Replaces the deleteIfExists → createDataConfig → createDb → assert
/// boilerplate that every db-backed test file re-declared.

import assert from "node:assert";
import { afterEach, beforeEach } from "node:test";

import {
  type TooManyCooksDataConfig,
  type TooManyCooksDb,
  createDataConfig,
} from "too-many-cooks-core";
import { createDb } from "../../src/db-sqlite.js";
import { deleteIfExists } from "./fs_helpers.js";

export type TestDbFixture = {
  readonly db: TooManyCooksDb;
  readonly config: TooManyCooksDataConfig;
};

export type RegisteredAgent = {
  readonly agentName: string;
  readonly agentKey: string;
};

/** Opens a db at dbPath WITHOUT deleting an existing file first. */
export const openTestDb = (dbPath: string): TestDbFixture => {
  const config = createDataConfig({ dbPath });
  const result = createDb(config);
  assert.strictEqual(result.ok, true);
  if (!result.ok) {
    throw new Error("expected ok");
  }
  return { db: result.value, config };
};

/** Deletes any leftover db file, then opens a fresh one. */
export const freshTestDb = (dbPath: string): TestDbFixture => {
  deleteIfExists(dbPath);
  return openTestDb(dbPath);
};

/** Closes the db (if open) and removes its file. */
export const teardownTestDb = async (
  db: TooManyCooksDb | undefined,
  dbPath: string,
): Promise<void> => {
  await db?.close();
  deleteIfExists(dbPath);
};

/** Access to the per-test db bound by `bindTestDb`. */
export type TestDbHandle = {
  readonly db: () => TooManyCooksDb;
  readonly config: () => TooManyCooksDataConfig;
};

const requireFixture = (
  fixture: TestDbFixture | undefined,
  dbPath: string,
): TestDbFixture => {
  assert.ok(fixture !== undefined, `no db bound for ${dbPath}`);
  return fixture;
};

/** Wires beforeEach/afterEach around a fresh db per test ([DEDUP-DESLOP]). */
export const bindTestDb = (dbPath: string): TestDbHandle => {
  let current: TestDbFixture | undefined;
  beforeEach(() => {
    current = freshTestDb(dbPath);
  });
  afterEach(async () => {
    await teardownTestDb(current?.db, dbPath);
  });
  return {
    db: (): TooManyCooksDb => requireFixture(current, dbPath).db,
    config: (): TooManyCooksDataConfig => requireFixture(current, dbPath).config,
  };
};

/** Access to a per-test registered agent bound by `bindAgentDb`. */
export type AgentDbHandle = {
  readonly db: () => TooManyCooksDb;
  readonly agent: () => RegisteredAgent;
};

/** Per-test db plus one registered agent ([DEDUP-DESLOP]). */
export const bindAgentDb = (
  dbPath: string,
  agentLabel: string,
): AgentDbHandle => {
  const testDb = bindTestDb(dbPath);
  let current: RegisteredAgent | undefined;
  beforeEach(async () => {
    current = await registerAgent(testDb.db(), agentLabel);
  });
  return {
    db: testDb.db,
    agent: (): RegisteredAgent => {
      if (current === undefined) { throw new Error(`no agent bound for ${dbPath}`); }
      return current;
    },
  };
};

/** Registers an agent and fails the test if registration fails. */
export const registerAgent = async (
  db: TooManyCooksDb,
  name: string,
): Promise<RegisteredAgent> => {
  const result = await db.register(name);
  assert.strictEqual(result.ok, true);
  if (!result.ok) {
    throw new Error("expected ok");
  }
  return result.value;
};

/** Registers two agents; returns them in registration order. */
export const registerAgentPair = async (
  db: TooManyCooksDb,
  firstName: string,
  secondName: string,
): Promise<readonly [RegisteredAgent, RegisteredAgent]> => [
  await registerAgent(db, firstName),
  await registerAgent(db, secondName),
];

/** Asserts a per-test db is bound and returns it (replaces `if (!db) throw`). */
export const requireDb = (db: TooManyCooksDb | undefined): TooManyCooksDb => {
  assert.notStrictEqual(db, undefined, "expected db");
  if (db === undefined) {
    throw new Error("expected db");
  }
  return db;
};
