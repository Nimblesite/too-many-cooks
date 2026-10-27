// Delete-agent referential integrity E2E.
//
// PROVES (end-to-end, through the live VSIX → MCP server → SQLite path) that
// deleting an agent cascades through every related table:
//   - the agent disappears from the Agents tree
//   - every lock that agent held disappears from the Locks tree
//   - every plan that agent owned disappears
//   - every message that agent SENT disappears
//   - every message that agent RECEIVED disappears
//   - other agents and their data are completely untouched
//
// The schema enforces this via ON DELETE CASCADE on locks, plans, and BOTH
// messages.from_agent AND messages.to_agent. If any FK is dropped, these
// assertions catch it immediately — no more orphaned rows in the UI.

import {
  acquireLockToolCall,
  assertAgentsInTree,
  assertEqual,
  assertLocksInTree,
  assertMessagesInTree,
  assertOk,
  callToolString,
  dumpAllTrees,
  ensureServerReady,
  extractKeyFromResult,
  getTestAPI,
  resetAndDrainAgents,
  safeDisconnect,
  sendMessageToolCall,
  uniqueName,
  updatePlanToolCall,
  waitForAgentGone,
  waitForAgentInTree,
  waitForCondition,
  waitForEach,
  waitForLockGone,
  waitForLockInTree,
  waitForMessageInTree,
} from './testHelpers';

const ALICE_BROADCAST_MESSAGE = 'cascade-alice-broadcast';

/** Messages the doomed agent sent or received; every one must cascade away. */
const ALICE_TOUCHED_MESSAGES: readonly string[] = [
  'cascade-alice-to-bob',
  'cascade-alice-to-carol',
  'cascade-bob-to-alice',
  'cascade-carol-to-alice',
  ALICE_BROADCAST_MESSAGE,
];

/** Unrelated conversation that must survive the delete untouched. */
const UNRELATED_MESSAGES: readonly string[] = ['cascade-bob-to-dave-unrelated', 'cascade-dave-to-bob-unrelated'];

/** Every cascade-test message, in the order the test seeds them. */
const ALL_CASCADE_MESSAGES: readonly string[] = [...ALICE_TOUCHED_MESSAGES, ...UNRELATED_MESSAGES];

/** Messages addressed to the doomed recipient in the orphan test. */
const ORPHAN_MESSAGES: readonly string[] = ['orphan-msg-1', 'orphan-msg-2', 'orphan-msg-3'];
const WITNESS_MESSAGE = 'orphan-witness-keepme';

/** Every message the delete-all test seeds. */
const ALL_DELETE_MESSAGES: readonly string[] = ['all-msg-a-to-b', 'all-msg-b-to-c', 'all-msg-c-to-a', 'all-broadcast-from-a'];

interface RegisteredAgent {
  readonly name: string;
  readonly key: string;
}

async function register(label: string): Promise<RegisteredAgent> {
  const api = getTestAPI();
  const name = uniqueName(label);
  const raw = await callToolString(api, 'register', { name });
  assertOk(!raw.includes('"error"'), `Register ${name} failed: ${raw}`);
  const key = extractKeyFromResult(raw);
  assertOk(key.length > 0, `Register ${name} returned empty key`);
  return { key, name };
}


/** Destructuring default that aborts the test if an agent is unexpectedly missing. */
function missingAgent(label: string): RegisteredAgent {
  throw new Error(`Registered agent missing: ${label}`);
}

/** Register several agents and wait until every one appears in the tree. */
async function registerAgents(names: readonly string[]): Promise<readonly RegisteredAgent[]> {
  const agents: RegisteredAgent[] = [];
  for (const label of names) {
    agents.push(await register(label));
  }
  const api = getTestAPI();
  for (const agent of agents) {
    await waitForAgentInTree(api, agent.name);
  }
  return agents;
}

/** Wait until every content snippet appears as a message in the tree. */
async function waitForMessagesInTree(contents: readonly string[]): Promise<void> {
  const api = getTestAPI();
  for (const content of contents) {
    await waitForMessageInTree(api, content);
  }
}
async function acquireLock(agent: RegisteredAgent, filePath: string): Promise<void> {
  const api = getTestAPI();
  const raw = await acquireLockToolCall(api, filePath, agent.name, agent.key, `edit-${filePath}`);
  assertOk(!raw.includes('"error"'), `Acquire ${filePath} by ${agent.name} failed: ${raw}`);
}

async function sendMessage(
  from: RegisteredAgent,
  toAgentName: string,
  content: string,
): Promise<void> {
  const api = getTestAPI();
  const raw = await sendMessageToolCall(api, from.name, from.key, toAgentName, content);
  assertOk(!raw.includes('"error"'), `Send "${content}" from ${from.name} to ${toAgentName} failed: ${raw}`);
}

async function updatePlan(
  agent: RegisteredAgent,
  goal: string,
  currentTask: string,
): Promise<void> {
  const api = getTestAPI();
  const raw = await updatePlanToolCall(api, agent.name, agent.key, goal, currentTask);
  assertOk(!raw.includes('"error"'), `Plan for ${agent.name} failed: ${raw}`);
}

function countMessagesInvolving(agentName: string): number {
  const api = getTestAPI();
  return api.getMessages().filter(
    (m) => m.fromAgent === agentName || m.toAgent === agentName,
  ).length;
}

function countLocksHeldBy(agentName: string): number {
  const api = getTestAPI();
  return api.getLocks().filter((l) => l.agentName === agentName).length;
}

function planExistsFor(agentName: string): boolean {
  const api = getTestAPI();
  return api.getPlans().some((p) => p.agentName === agentName);
}

suite('Delete Agent — Referential Integrity (cascade proof)', () => {
  suiteSetup(async () => {
    const api = await ensureServerReady();
    await api.refreshStatus();
  });

  suiteTeardown(async () => {
    await safeDisconnect();
  });

  test('deleting a single agent cascades to its locks, plans, outbound, inbound, and broadcast messages — and leaves everyone else intact', async () => {
    const api = await resetAndDrainAgents();

    // Build a small graph: alice (doomed) interacts with bob, carol, dave.
    const [alice = missingAgent('alice'), bob = missingAgent('bob'),
      carol = missingAgent('carol'), dave = missingAgent('dave')] =
      await registerAgents(['cascade-alice', 'cascade-bob', 'cascade-carol', 'cascade-dave']);

    // Alice grabs two locks; dave grabs one (must survive alice's delete).
    await acquireLock(alice, '/src/alice/one.ts');
    await acquireLock(alice, '/src/alice/two.ts');
    await acquireLock(dave, '/src/dave/keepme.ts');

    // Plans: alice + bob set plans (alice's must vanish, bob's must survive).
    await updatePlan(alice, 'Alice goal — will vanish', 'doomed task');
    await updatePlan(bob, 'Bob goal — must survive', 'safe task');

    // Messages: outbound from alice, inbound to alice, broadcast from alice,
    // plus an unrelated bob ↔ dave conversation that must not be touched.
    await sendMessage(alice, bob.name, 'cascade-alice-to-bob');
    await sendMessage(alice, carol.name, 'cascade-alice-to-carol');
    await sendMessage(bob, alice.name, 'cascade-bob-to-alice');
    await sendMessage(carol, alice.name, 'cascade-carol-to-alice');
    await sendMessage(alice, '*', 'cascade-alice-broadcast');
    await sendMessage(bob, dave.name, 'cascade-bob-to-dave-unrelated');
    await sendMessage(dave, bob.name, 'cascade-dave-to-bob-unrelated');

    // Wait for all tree views to catch up so we have a real "before" snapshot.
    await waitForEach(
      ['/src/alice/one.ts', '/src/alice/two.ts', '/src/dave/keepme.ts'],
      async (filePath: string): Promise<void> => { await waitForLockInTree(api, filePath); },
    );
    await waitForMessagesInTree(ALL_CASCADE_MESSAGES);
    await waitForCondition(() => api.getMessageCount() === 7, 'all 7 messages to land in the store');
    await waitForCondition(() => api.getPlans().length === 2, 'both plans to land in the store');

    // === BEFORE snapshot — sanity assertions ===
    dumpAllTrees(api, 'before');

    assertEqual(api.getAgentCount(), 4, 'before: 4 agents registered');
    assertAgentsInTree(api, [alice.name, bob.name, carol.name, dave.name], true);
    assertEqual(countLocksHeldBy(alice.name), 2, 'before: alice holds 2 locks');
    assertEqual(countLocksHeldBy(dave.name), 1, 'before: dave holds 1 lock');
    assertEqual(api.getLockCount(), 3, 'before: 3 total locks');
    assertOk(planExistsFor(alice.name), 'before: alice has a plan');
    assertOk(planExistsFor(bob.name), 'before: bob has a plan');
    assertEqual(api.getPlans().length, 2, 'before: 2 plans total');
    assertEqual(countMessagesInvolving(alice.name), 5, 'before: alice in 5 messages (2 out + 2 in + 1 broadcast)');
    assertEqual(api.getMessageCount(), 7, 'before: 7 total messages');
    assertMessagesInTree(api, [ALICE_BROADCAST_MESSAGE, ...UNRELATED_MESSAGES], true);

    // === ACT — delete alice through the VSIX admin path ===
    await api.deleteAgent(alice.name);
    await waitForAgentGone(api, alice.name);
    await waitForEach(
      ['/src/alice/one.ts', '/src/alice/two.ts'],
      async (filePath: string): Promise<void> => { await waitForLockGone(api, filePath); },
    );
    await waitForCondition(
      () => countMessagesInvolving(alice.name) === 0,
      'all messages involving alice to disappear',
    );

    // === AFTER snapshot — DOUBLE-DOWN assertions ===
    dumpAllTrees(api, 'after-alice-delete');

    // Agent gone
    assertAgentsInTree(api, [alice.name], false);
    assertEqual(api.getAgentCount(), 3, 'after: 3 agents remain');
    // Survivors still present
    assertAgentsInTree(api, [bob.name, carol.name, dave.name], true);
    // Locks
    assertEqual(countLocksHeldBy(alice.name), 0, 'after: zero locks held by alice');
    assertLocksInTree(api, ['/src/alice/one.ts', '/src/alice/two.ts'], false);
    assertLocksInTree(api, ['/src/dave/keepme.ts'], true);
    assertEqual(api.getLockCount(), 1, 'after: 1 lock total (dave\'s)');
    // Plans
    assertOk(!planExistsFor(alice.name), 'after: alice has no plan');
    assertOk(planExistsFor(bob.name), 'after: bob\'s plan survives');
    assertEqual(api.getPlans().length, 1, 'after: 1 plan total (bob\'s)');
    // Messages — both directions cleaned, broadcast cleaned, unrelated untouched
    assertEqual(countMessagesInvolving(alice.name), 0, 'after: ZERO messages touch alice (no orphans!)');
    assertMessagesInTree(api, ALICE_TOUCHED_MESSAGES, false);
    assertMessagesInTree(api, UNRELATED_MESSAGES, true);
    assertEqual(api.getMessageCount(), 2, 'after: exactly 2 unrelated messages remain');
  });

  test('deleting the recipient of a message removes that message (the exact bug from the user\'s screenshot)', async () => {
    const api = await resetAndDrainAgents();

    const [sender = missingAgent('sender'), doomed = missingAgent('doomed'),
      witness = missingAgent('witness')] =
      await registerAgents(['orphan-sender', 'orphan-doomed-recipient', 'orphan-witness']);

    for (const content of ORPHAN_MESSAGES) {
      await sendMessage(sender, doomed.name, content);
    }
    await sendMessage(sender, witness.name, WITNESS_MESSAGE);

    await waitForMessagesInTree([...ORPHAN_MESSAGES, WITNESS_MESSAGE]);
    await waitForCondition(() => api.getMessageCount() === 4, 'all 4 messages to land in the store');

    // BEFORE
    assertEqual(api.getMessageCount(), 4, 'before: 4 messages total');
    assertEqual(countMessagesInvolving(doomed.name), 3, 'before: 3 messages target the doomed agent');
    assertAgentsInTree(api, [doomed.name], true);
    assertMessagesInTree(api, ORPHAN_MESSAGES, true);

    // ACT: delete the RECEIVER. Pre-fix this left messages orphaned with no
    // matching identity row — exactly what produced the user's screenshot.
    await api.deleteAgent(doomed.name);
    await waitForAgentGone(api, doomed.name);
    await waitForCondition(
      () => countMessagesInvolving(doomed.name) === 0,
      'inbound messages to vanish with the recipient',
    );

    // AFTER
    assertAgentsInTree(api, [doomed.name], false);
    assertEqual(countMessagesInvolving(doomed.name), 0, 'after: no orphaned messages reference the dead recipient');
    assertMessagesInTree(api, ORPHAN_MESSAGES, false);
    assertMessagesInTree(api, [WITNESS_MESSAGE], true);
    assertEqual(api.getMessageCount(), 1, 'after: exactly 1 message remains');
    assertEqual(api.getAgentCount(), 2, 'after: 2 agents survive');
  });

  test('deleteAllAgents wipes every agent, every lock, every plan, and every message in one shot', async () => {
    const api = await resetAndDrainAgents();

    // Stand up a small population with locks, plans, direct + broadcast msgs.
    const [a = missingAgent('a'), b = missingAgent('b'), c = missingAgent('c')] =
      await registerAgents(['all-delete-a', 'all-delete-b', 'all-delete-c']);

    await acquireLock(a, '/all/a1.ts');
    await acquireLock(a, '/all/a2.ts');
    await acquireLock(b, '/all/b1.ts');
    await acquireLock(c, '/all/c1.ts');

    await updatePlan(a, 'plan-a-goal', 'plan-a-task');
    await updatePlan(b, 'plan-b-goal', 'plan-b-task');
    await updatePlan(c, 'plan-c-goal', 'plan-c-task');

    const [MSG_A_TO_B = '', MSG_B_TO_C = '', MSG_C_TO_A = '', BROADCAST_FROM_A = ''] = ALL_DELETE_MESSAGES;
    await sendMessage(a, b.name, MSG_A_TO_B);
    await sendMessage(b, c.name, MSG_B_TO_C);
    await sendMessage(c, a.name, MSG_C_TO_A);
    await sendMessage(a, '*', BROADCAST_FROM_A);

    await waitForEach(
      ['/all/a1.ts', '/all/a2.ts', '/all/b1.ts', '/all/c1.ts'],
      async (filePath: string): Promise<void> => { await waitForLockInTree(api, filePath); },
    );
    await waitForMessagesInTree(ALL_DELETE_MESSAGES);
    await waitForCondition(() => api.getMessageCount() === 4, 'all 4 messages to land in the store');
    await waitForCondition(() => api.getLockCount() === 4, 'all 4 locks to land in the store');
    await waitForCondition(() => api.getPlans().length === 3, 'all 3 plans to land in the store');

    // BEFORE
    assertEqual(api.getAgentCount(), 3, 'before: 3 agents');
    assertEqual(api.getLockCount(), 4, 'before: 4 locks');
    assertEqual(api.getPlans().length, 3, 'before: 3 plans');
    assertEqual(api.getMessageCount(), 4, 'before: 4 messages');

    // ACT: delete-all through the VSIX command path.
    await api.deleteAllAgents();
    await waitForEach([a.name, b.name, c.name], async (name: string): Promise<void> => { await waitForAgentGone(api, name); });
    await waitForEach(
      ['/all/a1.ts', '/all/b1.ts'],
      async (filePath: string): Promise<void> => { await waitForLockGone(api, filePath); },
    );
    await waitForCondition(() => api.getMessageCount() === 0, 'all messages to drain');

    // AFTER — every assertion that can possibly fire, fires.
    dumpAllTrees(api, 'after-all');

    assertEqual(api.getAgentCount(), 0, 'after: zero agents');
    assertAgentsInTree(api, [a.name, b.name, c.name], false);
    assertEqual(api.getLockCount(), 0, 'after: zero locks');
    assertLocksInTree(api, ['/all/a1.ts', '/all/a2.ts', '/all/b1.ts', '/all/c1.ts'], false);
    assertEqual(api.getPlans().length, 0, 'after: zero plans');
    assertEqual(api.getMessageCount(), 0, 'after: zero messages');
    assertMessagesInTree(api, ALL_DELETE_MESSAGES, false);

    // The broadcast sentinel '*' must NOT be visible as a deletable agent in
    // the UI, and the tree count must reflect that.
    assertAgentsInTree(api, ['*'], false);

    // Re-registering after a full wipe must still work — and broadcasts must
    // still work, which proves the '*' sentinel survived the delete-all.
    const fresh = await register('after-wipe');
    await waitForAgentInTree(api, fresh.name);
    await sendMessage(fresh, '*', 'after-wipe-broadcast');
    await waitForMessageInTree(api, 'after-wipe-broadcast');
    assertEqual(api.getAgentCount(), 1, 'post-wipe: 1 fresh agent');
    assertEqual(api.getMessageCount(), 1, 'post-wipe: 1 broadcast message');
    assertMessagesInTree(api, ['after-wipe-broadcast'], true);
  });
});
