/// Shared scaffold for the TooManyCooksDb contract test suite.
///
/// Types, constants, and helpers shared by the per-feature contract test
/// modules under `db-contract/`. Any implementation of TooManyCooksDb
/// that passes the suites built on this scaffold is guaranteed
/// interchangeable with the SQLite implementation.

import { afterEach, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import type { TooManyCooksDb } from "../db-interface.js";
import type {
  AgentIdentity,
  AgentPlan,
  AgentRegistration,
  FileLock,
  LockResult,
  Message,
} from "../types.gen.js";

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

/** Options accepted by `getMessages`. */
export type GetMessagesOptions = {
  readonly unreadOnly?: boolean;
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

/** Character repeated to build boundary-length agent names. */
const REPEATED_NAME_CHAR: string = "a";

/** Name of the second agent used by multi-agent fixtures. */
const SECOND_AGENT_NAME: string = "agent2";

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

/** Assert a Result is a success. */
export const assertOk = (result: { readonly ok: boolean }): void => {
  assert.strictEqual(result.ok, true);
};

/** Register a fresh agent and return its registration. */
export const registerAgent = async (inst: DbInstance, name: string): Promise<AgentRegistration> =>
  unwrap(await inst.db.register(name));

/** Register each name in order. */
export const registerAgents = async (inst: DbInstance, names: readonly string[]): Promise<void> => {
  for (const name of names) {
    await registerAgent(inst, name);
  }
};

/** Register exactly two agents and return both registrations. */
export const registerPair = async (
  inst: DbInstance,
  firstName: string,
  secondName: string,
): Promise<readonly [AgentRegistration, AgentRegistration]> =>
  [await registerAgent(inst, firstName), await registerAgent(inst, secondName)];

/** Register a name built from `length` repeated characters. */
export const registerRepeatedName = async (
  inst: DbInstance,
  length: number,
): Promise<Awaited<ReturnType<TooManyCooksDb["register"]>>> =>
  await inst.db.register(REPEATED_NAME_CHAR.repeat(length));

/** Register `name` and authenticate with its fresh key. */
export const registerAndAuthenticate = async (
  inst: DbInstance,
  name: string,
): Promise<{ readonly reg: AgentRegistration; readonly auth: AgentIdentity }> => {
  const reg: AgentRegistration = await registerAgent(inst, name);
  const auth: AgentIdentity = unwrap(await inst.db.authenticate(name, reg.agentKey));
  return { reg, auth };
};

/** Assert `agentKey` resolves to `expectedName`. */
export const assertKeyBelongsTo = async (
  inst: DbInstance,
  agentKey: string,
  expectedName: string,
): Promise<void> => {
  const name: string = unwrap(await inst.db.lookupByKey(agentKey));
  assert.strictEqual(name, expectedName);
};

/** Assert each expected string appears among the values that `field` reads. */
export const assertContainsAll = <T>(
  items: readonly T[],
  field: (item: T) => string,
  expected: readonly string[],
): void => {
  const values: Set<string> = new Set<string>(items.map(field));
  for (const value of expected) {
    assert.ok(values.has(value));
  }
};

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

/** Register `name` and expose the instance plus credentials. */
const agentSetup = async (inst: DbInstance, name: string): Promise<AgentState> => {
  const reg: AgentRegistration = await registerAgent(inst, name);
  return { inst, agentName: reg.agentName, agentKey: reg.agentKey };
};

/** Register a lock agent for a suite. */
export const lockSetup = async (inst: DbInstance): Promise<AgentState> => await agentSetup(inst, "lock-agent");

/** Register a plan agent for a suite. */
export const planSetup = async (inst: DbInstance): Promise<AgentState> => await agentSetup(inst, "plan-agent");

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

/** Have the suite's agent acquire `filePath`. */
export const acquireLockFor = async (
  state: AgentState,
  filePath: string,
  timeoutMs: number,
  reason: string | null = null,
): Promise<LockResult> =>
  unwrap(await state.inst.db.acquireLock(filePath, state.agentName, state.agentKey, reason, timeoutMs));

/** Have an arbitrary registered agent acquire `filePath`. */
export const acquireLockAs = async (
  inst: DbInstance,
  reg: AgentRegistration,
  filePath: string,
  timeoutMs: number,
  reason: string | null = null,
): Promise<LockResult> =>
  unwrap(await inst.db.acquireLock(filePath, reg.agentName, reg.agentKey, reason, timeoutMs));

/** Register a second agent against the suite instance. */
export const registerSecondAgent = async (state: AgentState): Promise<AgentRegistration> =>
  await registerAgent(state.inst, SECOND_AGENT_NAME);

/** Register `name` and have it hold `filePath` with the default timeout. */
export const registerAndAcquireLock = async (
  inst: DbInstance,
  name: string,
  filePath: string,
): Promise<AgentRegistration> => {
  const reg: AgentRegistration = await registerAgent(inst, name);
  await acquireLockAs(inst, reg, filePath, DEFAULT_LOCK_TIMEOUT_MS);
  return reg;
};

/** Assert `filePath` is not locked. */
export const assertLockReleased = async (inst: DbInstance, filePath: string): Promise<void> => {
  const lock: FileLock | null = unwrap(await inst.db.queryLock(filePath));
  assert.strictEqual(lock, null);
};

/** List every plan. */
export const listPlans = async (inst: DbInstance): Promise<readonly AgentPlan[]> => unwrap(await inst.db.listPlans());

/** Apply a plan update for one registered agent. */
export const applyPlanUpdate = async (
  inst: DbInstance,
  reg: { readonly agentName: string; readonly agentKey: string },
  goal: string,
  currentTask: string,
): Promise<void> => {
  unwrap(await inst.db.updatePlan(reg.agentName, reg.agentKey, goal, currentTask));
};

/** Apply the goal1/task1 and goal2/task2 updates, then list all plans. */
export const applyStandardPlanUpdates = async (
  state: AgentState,
  second: { readonly agentName: string; readonly agentKey: string },
): Promise<readonly AgentPlan[]> => {
  await applyPlanUpdate(state.inst, state, "goal1", "task1");
  await applyPlanUpdate(state.inst, second, "goal2", "task2");
  return await listPlans(state.inst);
};

/** Update the suite agent's plan and read it back. */
export const updateAndGetPlan = async (
  state: AgentState,
  goal: string,
  currentTask: string,
): Promise<AgentPlan | null> => {
  await applyPlanUpdate(state.inst, state, goal, currentTask);
  return unwrap(await state.inst.db.getPlan(state.agentName));
};

/** Send a message from the suite's sender to `toAgent`. */
export const sendFromSender = async (
  state: MessageState,
  toAgent: string,
  content: string,
): Promise<string> => unwrap(await state.inst.db.sendMessage(state.senderName, state.senderKey, toAgent, content));

/** Send a message from the suite's sender to its receiver. */
export const sendToReceiver = async (state: MessageState, content: string): Promise<string> =>
  await sendFromSender(state, state.receiverName, content);

/** Fetch the receiver's messages. */
export const fetchReceiverMessages = async (
  state: MessageState,
  options?: GetMessagesOptions,
): Promise<readonly Message[]> => unwrap(await state.inst.db.getMessages(state.receiverName, state.receiverKey, options));

/** Fetch the receiver's messages and assert how many there are. */
export const expectReceiverMessageCount = async (
  state: MessageState,
  options: GetMessagesOptions,
  expected: number,
): Promise<readonly Message[]> => {
  const messages: readonly Message[] = await fetchReceiverMessages(state, options);
  assert.strictEqual(messages.length, expected);
  return messages;
};
