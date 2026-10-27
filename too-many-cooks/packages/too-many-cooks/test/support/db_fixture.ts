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

/** Access to per-test registered agents bound by `bindAgentsDb`. */
export type AgentsDbHandle = {
  readonly db: () => TooManyCooksDb;
  readonly agents: () => readonly RegisteredAgent[];
  /** `agents()[index]`, failing the test when absent. */
  readonly agentAt: (index: number) => RegisteredAgent;
};

/** Per-test db plus `agentLabels.length` registered agents, in order. */
export const bindAgentsDb = (
  dbPath: string,
  agentLabels: readonly string[],
): AgentsDbHandle => {
  const testDb = bindTestDb(dbPath);
  let current: readonly RegisteredAgent[] | undefined;
  beforeEach(async () => {
    current = await registerAgentList(testDb.db(), agentLabels);
  });
  return {
    db: testDb.db,
    agents: (): readonly RegisteredAgent[] => requireAgents(current, dbPath),
    agentAt: (index: number): RegisteredAgent =>
      requireAgentAt(requireAgents(current, dbPath), index),
  };
};

/** `agents[index]`, failing the test when absent. */
export const requireAgentAt = (
  agents: readonly RegisteredAgent[],
  index: number,
): RegisteredAgent => {
  const agent = agents[index];
  assert.ok(agent !== undefined, `no agent at index ${String(index)}`);
  return agent;
};

/** Asserts the agent list is bound and returns it. */
const requireAgents = (
  agents: readonly RegisteredAgent[] | undefined,
  dbPath: string,
): readonly RegisteredAgent[] => {
  assert.ok(agents !== undefined, `no agents bound for ${dbPath}`);
  return agents;
};

/** Registers every label in order; fails the test if any registration fails. */
export const registerAgentList = async (
  db: TooManyCooksDb,
  agentLabels: readonly string[],
): Promise<readonly RegisteredAgent[]> => {
  const agents: RegisteredAgent[] = [];
  for (const label of agentLabels) {
    agents.push(await registerAgent(db, label));
  }
  return agents;
};

/** Per-test db plus one registered agent ([DEDUP-DESLOP]). */
export const bindAgentDb = (
  dbPath: string,
  agentLabel: string,
): AgentDbHandle => {
  const agentsDb = bindAgentsDb(dbPath, [agentLabel]);
  return {
    db: agentsDb.db,
    agent: (): RegisteredAgent => agentsDb.agentAt(0),
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

/** Db plus the bound agent's credentials ([DEDUP-DESLOP]). */
export type AgentActor = {
  readonly db: TooManyCooksDb;
  readonly agentName: string;
  readonly agentKey: string;
};

/** Snapshot of a bound agent handle as a flat actor ([DEDUP-DESLOP]). */
export const agentActor = (handle: AgentDbHandle): AgentActor => {
  const { agentName, agentKey } = handle.agent();
  return { db: handle.db(), agentName, agentKey };
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
