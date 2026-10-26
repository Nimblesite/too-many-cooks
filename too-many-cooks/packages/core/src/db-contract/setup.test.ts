/// Shared scaffold for the TooManyCooksDb contract test suite.
///
/// Types, constants, and helpers shared by the per-feature contract test
/// modules under `db-contract/`. Any implementation of TooManyCooksDb
/// that passes the suites built on this scaffold is guaranteed
/// interchangeable with the SQLite implementation.

import { afterEach, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import type { TooManyCooksDb } from "../db-interface.js";
import type { AgentRegistration } from "../types.gen.js";

/** Result of creating a test db instance. */
export type DbInstance = {
  readonly db: TooManyCooksDb;
  readonly cleanup: () => Promise<void>;
};

/** Factory type for creating test db instances. */
export type DbFactory = () => Promise<DbInstance>;

/** Result type for unwrap. */
type OkResult<T> = {
  readonly ok: true;
  readonly value: T;
};

/** Expected key length in hex chars (32 bytes = 64 hex). */
export const EXPECTED_KEY_LENGTH: number = 64;

/** Expected message ID length. */
export const EXPECTED_MESSAGE_ID_LENGTH: number = 16;

/** Default lock timeout in ms. */
export const DEFAULT_LOCK_TIMEOUT_MS: number = 600_000;

/** Immediately-expired lock timeout. */
export const EXPIRED_LOCK_TIMEOUT_MS: number = 0;

/** Short lock timeout for renewal tests. */
export const SHORT_LOCK_TIMEOUT_MS: number = 1_000;

/** Long lock timeout for renewal tests. */
export const LONG_LOCK_TIMEOUT_MS: number = 60_000;

/** Max agent name length. */
export const MAX_AGENT_NAME_LENGTH: number = 50;

/** Over max agent name length. */
export const OVER_MAX_AGENT_NAME_LENGTH: number = 51;

/** Broadcast recipient. */
export const BROADCAST_RECIPIENT: string = "*";

/** Shared state for a suite that registers a single agent. */
export type AgentState = {
  readonly inst: DbInstance;
  readonly agentName: string;
  readonly agentKey: string;
};

/** Shared state for a suite that registers a sender and receiver. */
export type MessageState = {
  readonly inst: DbInstance;
  readonly senderName: string;
  readonly senderKey: string;
  readonly receiverName: string;
  readonly receiverKey: string;
};

/** Type guard: value is an OkResult. */
const isOkResult = <T>(
  result: { readonly ok: boolean; readonly value?: T; readonly error?: unknown },
): result is OkResult<T> => result.ok;

/** Unwrap a successful Result or throw. */
export const unwrap = <T>(
  result: { readonly ok: boolean; readonly value?: T; readonly error?: unknown },
): T => {
  if (!isOkResult(result)) {
    throw new Error(`Expected ok result, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

/** Assert a Result is an error with the expected code. */
export const assertError = (
  result: { readonly ok: boolean; readonly error?: { readonly code: string } },
  expectedCode: string,
): void => {
  assert.strictEqual(result.ok, false, `Expected error with code ${expectedCode}, got ok`);
  assert.strictEqual(result.error?.code, expectedCode);
};

/** Register a fresh agent and return its registration. */
export const registerAgent = async (inst: DbInstance, name: string): Promise<AgentRegistration> =>
  unwrap(await inst.db.register(name));

/** Pass the fresh instance through unchanged. */
export const freshInstance = (inst: DbInstance): DbInstance => inst;

/** Clean up a db instance. */
export const cleanupInstance = async (inst: DbInstance): Promise<void> => {
  await inst.cleanup();
};

/** Clean up a suite state that carries an instance. */
export const cleanupState = async (state: { readonly inst: DbInstance }): Promise<void> => {
  await state.inst.cleanup();
};

/** Describe a contract suite with shared per-test setup and teardown. */
export const describeSuite = <S>(
  createTestDb: DbFactory,
  suiteName: string,
  setup: (inst: DbInstance) => S | Promise<S>,
  teardown: (state: S) => void | Promise<void>,
  register: (getState: () => S) => void,
): void => {
  describe(suiteName, () => {
    let state: S;
    beforeEach(async (): Promise<void> => {
      state = await setup(await createTestDb());
    });
    afterEach(async (): Promise<void> => {
      await teardown(state);
    });
    register((): S => state);
  });
};

/** Register a lock agent for a suite. */
export const lockSetup = async (inst: DbInstance): Promise<AgentState> => {
  const reg: AgentRegistration = await registerAgent(inst, "lock-agent");
  return { inst, agentName: reg.agentName, agentKey: reg.agentKey };
};

/** Register a plan agent for a suite. */
export const planSetup = async (inst: DbInstance): Promise<AgentState> => {
  const reg: AgentRegistration = await registerAgent(inst, "plan-agent");
  return { inst, agentName: reg.agentName, agentKey: reg.agentKey };
};

/** Register a sender and receiver for a suite. */
export const messageSetup = async (inst: DbInstance): Promise<MessageState> => {
  const sender: AgentRegistration = await registerAgent(inst, "sender");
  const receiver: AgentRegistration = await registerAgent(inst, "receiver");
  return {
    inst,
    senderName: sender.agentName,
    senderKey: sender.agentKey,
    receiverName: receiver.agentName,
    receiverKey: receiver.agentKey,
  };
};
