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
  waitForExtensionActivation,
  waitForConnection,
  waitForAgentInTree,
  waitForAgentGone,
  waitForLockInTree,
  waitForLockGone,
  waitForMessageInTree,
  waitForCondition,
  safeDisconnect,
  getTestAPI,
  callToolString,
  extractKeyFromResult,
  resetServerState,
  assertOk,
  assertEqual,
  dumpTree,
} from './testHelpers';

interface RegisteredAgent {
  readonly name: string;
  readonly key: string;
}

const register = async (label: string): Promise<RegisteredAgent> => {
  const api = getTestAPI();
  const name = `${label}-${String(Date.now())}-${String(Math.floor(Math.random() * 100000))}`;
  const raw = await callToolString(api, 'register', { name });
  assertOk(!raw.includes('"error"'), `Register ${name} failed: ${raw}`);
  const key = extractKeyFromResult(raw);
  assertOk(key.length > 0, `Register ${name} returned empty key`);
  return { key, name };
};

const acquireLock = async (agent: RegisteredAgent, filePath: string): Promise<void> => {
  const api = getTestAPI();
  const raw = await callToolString(api, 'lock', {
    action: 'acquire',
    agent_key: agent.key,
    agent_name: agent.name,
    file_path: filePath,
    reason: `edit-${filePath}`,
  });
  assertOk(!raw.includes('"error"'), `Acquire ${filePath} by ${agent.name} failed: ${raw}`);
};

const sendMessage = async (
  from: RegisteredAgent,
  toAgentName: string,
  content: string,
): Promise<void> => {
  const api = getTestAPI();
  const raw = await callToolString(api, 'message', {
    action: 'send',
    agent_key: from.key,
    agent_name: from.name,
    content,
    to_agent: toAgentName,
  });
  assertOk(!raw.includes('"error"'), `Send "${content}" from ${from.name} to ${toAgentName} failed: ${raw}`);
};

const updatePlan = async (
  agent: RegisteredAgent,
  goal: string,
  currentTask: string,
): Promise<void> => {
  const api = getTestAPI();
  const raw = await callToolString(api, 'plan', {
    action: 'update',
    agent_key: agent.key,
    agent_name: agent.name,
    current_task: currentTask,
    goal,
  });
  assertOk(!raw.includes('"error"'), `Plan for ${agent.name} failed: ${raw}`);
};

const countMessagesInvolving = (agentName: string): number => {
  const api = getTestAPI();
  return api.getMessages().filter(
    (m) => m.fromAgent === agentName || m.toAgent === agentName,
  ).length;
};

const countLocksHeldBy = (agentName: string): number => {
  const api = getTestAPI();
  return api.getLocks().filter((l) => l.agentName === agentName).length;
};

const planExistsFor = (agentName: string): boolean => {
  const api = getTestAPI();
  return api.getPlans().some((p) => p.agentName === agentName);
};

suite('Delete Agent — Referential Integrity (cascade proof)', () => {
  suiteSetup(async () => {
    await waitForExtensionActivation();
    const api = getTestAPI();
    if (!api.isConnected()) {
      await api.connect();
      await waitForConnection();
    }
    await resetServerState();
    await api.refreshStatus();
  });

  suiteTeardown(async () => {
    await safeDisconnect();
  });

  test('deleting a single agent cascades to its locks, plans, outbound, inbound, and broadcast messages — and leaves everyone else intact', async () => {
    const api = getTestAPI();
    await resetServerState();
    await api.refreshStatus();
    await waitForCondition(() => api.getAgentCount() === 0, 'agents to drain after reset');

    // Build a small graph: alice (doomed) interacts with bob, carol, dave.
    const alice = await register('cascade-alice');
    const bob = await register('cascade-bob');
    const carol = await register('cascade-carol');
    const dave = await register('cascade-dave');

    await waitForAgentInTree(api, alice.name);
    await waitForAgentInTree(api, bob.name);
    await waitForAgentInTree(api, carol.name);
    await waitForAgentInTree(api, dave.name);

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
    await waitForLockInTree(api, '/src/alice/one.ts');
    await waitForLockInTree(api, '/src/alice/two.ts');
    await waitForLockInTree(api, '/src/dave/keepme.ts');
    await waitForMessageInTree(api, 'cascade-alice-to-bob');
    await waitForMessageInTree(api, 'cascade-alice-to-carol');
    await waitForMessageInTree(api, 'cascade-bob-to-alice');
    await waitForMessageInTree(api, 'cascade-carol-to-alice');
    await waitForMessageInTree(api, 'cascade-alice-broadcast');
    await waitForMessageInTree(api, 'cascade-bob-to-dave-unrelated');
    await waitForMessageInTree(api, 'cascade-dave-to-bob-unrelated');
    await waitForCondition(() => api.getMessageCount() === 7, 'all 7 messages to land in the store');
    await waitForCondition(() => api.getPlans().length === 2, 'both plans to land in the store');

    // === BEFORE snapshot — sanity assertions ===
    dumpTree('AGENTS-before', api.getAgentsTreeSnapshot());
    dumpTree('LOCKS-before', api.getLocksTreeSnapshot());
    dumpTree('MESSAGES-before', api.getMessagesTreeSnapshot());

    assertEqual(api.getAgentCount(), 4, 'before: 4 agents registered');
    assertOk(api.findAgentInTree(alice.name) !== null, 'before: alice in agents tree');
    assertOk(api.findAgentInTree(bob.name) !== null, 'before: bob in agents tree');
    assertOk(api.findAgentInTree(carol.name) !== null, 'before: carol in agents tree');
    assertOk(api.findAgentInTree(dave.name) !== null, 'before: dave in agents tree');
    assertEqual(countLocksHeldBy(alice.name), 2, 'before: alice holds 2 locks');
    assertEqual(countLocksHeldBy(dave.name), 1, 'before: dave holds 1 lock');
    assertEqual(api.getLockCount(), 3, 'before: 3 total locks');
    assertOk(planExistsFor(alice.name), 'before: alice has a plan');
    assertOk(planExistsFor(bob.name), 'before: bob has a plan');
    assertEqual(api.getPlans().length, 2, 'before: 2 plans total');
    assertEqual(countMessagesInvolving(alice.name), 5, 'before: alice in 5 messages (2 out + 2 in + 1 broadcast)');
    assertEqual(api.getMessageCount(), 7, 'before: 7 total messages');
    assertOk(api.findMessageInTree('cascade-alice-broadcast') !== null, 'before: broadcast visible');
    assertOk(api.findMessageInTree('cascade-bob-to-dave-unrelated') !== null, 'before: unrelated bob→dave visible');

    // === ACT — delete alice through the VSIX admin path ===
    await api.deleteAgent(alice.name);
    await waitForAgentGone(api, alice.name);
    await waitForLockGone(api, '/src/alice/one.ts');
    await waitForLockGone(api, '/src/alice/two.ts');
    await waitForCondition(
      () => countMessagesInvolving(alice.name) === 0,
      'all messages involving alice to disappear',
    );

    // === AFTER snapshot — DOUBLE-DOWN assertions ===
    dumpTree('AGENTS-after-alice-delete', api.getAgentsTreeSnapshot());
    dumpTree('LOCKS-after-alice-delete', api.getLocksTreeSnapshot());
    dumpTree('MESSAGES-after-alice-delete', api.getMessagesTreeSnapshot());

    // Agent gone
    assertEqual(api.findAgentInTree(alice.name), null, 'after: alice not in agents tree');
    assertEqual(api.getAgentCount(), 3, 'after: 3 agents remain');
    // Survivors still present
    assertOk(api.findAgentInTree(bob.name) !== null, 'after: bob survives');
    assertOk(api.findAgentInTree(carol.name) !== null, 'after: carol survives');
    assertOk(api.findAgentInTree(dave.name) !== null, 'after: dave survives');
    // Locks
    assertEqual(countLocksHeldBy(alice.name), 0, 'after: zero locks held by alice');
    assertEqual(api.findLockInTree('/src/alice/one.ts'), null, 'after: /src/alice/one.ts NOT in locks tree');
    assertEqual(api.findLockInTree('/src/alice/two.ts'), null, 'after: /src/alice/two.ts NOT in locks tree');
    assertOk(api.findLockInTree('/src/dave/keepme.ts') !== null, 'after: dave\'s lock survives');
    assertEqual(api.getLockCount(), 1, 'after: 1 lock total (dave\'s)');
    // Plans
    assertOk(!planExistsFor(alice.name), 'after: alice has no plan');
    assertOk(planExistsFor(bob.name), 'after: bob\'s plan survives');
    assertEqual(api.getPlans().length, 1, 'after: 1 plan total (bob\'s)');
    // Messages — both directions cleaned, broadcast cleaned, unrelated untouched
    assertEqual(countMessagesInvolving(alice.name), 0, 'after: ZERO messages touch alice (no orphans!)');
    assertEqual(api.findMessageInTree('cascade-alice-to-bob'), null, 'after: outbound alice→bob gone');
    assertEqual(api.findMessageInTree('cascade-alice-to-carol'), null, 'after: outbound alice→carol gone');
    assertEqual(api.findMessageInTree('cascade-bob-to-alice'), null, 'after: inbound bob→alice gone');
    assertEqual(api.findMessageInTree('cascade-carol-to-alice'), null, 'after: inbound carol→alice gone');
    assertEqual(api.findMessageInTree('cascade-alice-broadcast'), null, 'after: alice broadcast gone');
    assertOk(api.findMessageInTree('cascade-bob-to-dave-unrelated') !== null, 'after: unrelated bob→dave survives');
    assertOk(api.findMessageInTree('cascade-dave-to-bob-unrelated') !== null, 'after: unrelated dave→bob survives');
    assertEqual(api.getMessageCount(), 2, 'after: exactly 2 unrelated messages remain');
  });

  test('deleting the recipient of a message removes that message (the exact bug from the user\'s screenshot)', async () => {
    const api = getTestAPI();
    await resetServerState();
    await api.refreshStatus();
    await waitForCondition(() => api.getAgentCount() === 0, 'agents to drain after reset');

    const sender = await register('orphan-sender');
    const doomed = await register('orphan-doomed-recipient');
    const witness = await register('orphan-witness');

    await waitForAgentInTree(api, sender.name);
    await waitForAgentInTree(api, doomed.name);
    await waitForAgentInTree(api, witness.name);

    await sendMessage(sender, doomed.name, 'orphan-msg-1');
    await sendMessage(sender, doomed.name, 'orphan-msg-2');
    await sendMessage(sender, doomed.name, 'orphan-msg-3');
    await sendMessage(sender, witness.name, 'orphan-witness-keepme');

    await waitForMessageInTree(api, 'orphan-msg-1');
    await waitForMessageInTree(api, 'orphan-msg-2');
    await waitForMessageInTree(api, 'orphan-msg-3');
    await waitForMessageInTree(api, 'orphan-witness-keepme');
    await waitForCondition(() => api.getMessageCount() === 4, 'all 4 messages to land in the store');

    // BEFORE
    assertEqual(api.getMessageCount(), 4, 'before: 4 messages total');
    assertEqual(countMessagesInvolving(doomed.name), 3, 'before: 3 messages target the doomed agent');
    assertOk(api.findAgentInTree(doomed.name) !== null, 'before: doomed agent present');
    assertOk(api.findMessageInTree('orphan-msg-1') !== null, 'before: orphan-msg-1 visible in tree');
    assertOk(api.findMessageInTree('orphan-msg-2') !== null, 'before: orphan-msg-2 visible in tree');
    assertOk(api.findMessageInTree('orphan-msg-3') !== null, 'before: orphan-msg-3 visible in tree');

    // ACT: delete the RECEIVER. Pre-fix this left messages orphaned with no
    // matching identity row — exactly what produced the user's screenshot.
    await api.deleteAgent(doomed.name);
    await waitForAgentGone(api, doomed.name);
    await waitForCondition(
      () => countMessagesInvolving(doomed.name) === 0,
      'inbound messages to vanish with the recipient',
    );

    // AFTER
    assertEqual(api.findAgentInTree(doomed.name), null, 'after: doomed agent gone from tree');
    assertEqual(countMessagesInvolving(doomed.name), 0, 'after: no orphaned messages reference the dead recipient');
    assertEqual(api.findMessageInTree('orphan-msg-1'), null, 'after: orphan-msg-1 cascade-deleted');
    assertEqual(api.findMessageInTree('orphan-msg-2'), null, 'after: orphan-msg-2 cascade-deleted');
    assertEqual(api.findMessageInTree('orphan-msg-3'), null, 'after: orphan-msg-3 cascade-deleted');
    assertOk(api.findMessageInTree('orphan-witness-keepme') !== null, 'after: unrelated witness message survives');
    assertEqual(api.getMessageCount(), 1, 'after: exactly 1 message remains');
    assertEqual(api.getAgentCount(), 2, 'after: 2 agents survive');
  });

  test('deleteAllAgents wipes every agent, every lock, every plan, and every message in one shot', async () => {
    const api = getTestAPI();
    await resetServerState();
    await api.refreshStatus();
    await waitForCondition(() => api.getAgentCount() === 0, 'agents to drain after reset');

    // Stand up a small population with locks, plans, direct + broadcast msgs.
    const a = await register('all-delete-a');
    const b = await register('all-delete-b');
    const c = await register('all-delete-c');

    await waitForAgentInTree(api, a.name);
    await waitForAgentInTree(api, b.name);
    await waitForAgentInTree(api, c.name);

    await acquireLock(a, '/all/a1.ts');
    await acquireLock(a, '/all/a2.ts');
    await acquireLock(b, '/all/b1.ts');
    await acquireLock(c, '/all/c1.ts');

    await updatePlan(a, 'plan-a-goal', 'plan-a-task');
    await updatePlan(b, 'plan-b-goal', 'plan-b-task');
    await updatePlan(c, 'plan-c-goal', 'plan-c-task');

    await sendMessage(a, b.name, 'all-msg-a-to-b');
    await sendMessage(b, c.name, 'all-msg-b-to-c');
    await sendMessage(c, a.name, 'all-msg-c-to-a');
    await sendMessage(a, '*', 'all-broadcast-from-a');

    await waitForLockInTree(api, '/all/a1.ts');
    await waitForLockInTree(api, '/all/a2.ts');
    await waitForLockInTree(api, '/all/b1.ts');
    await waitForLockInTree(api, '/all/c1.ts');
    await waitForMessageInTree(api, 'all-msg-a-to-b');
    await waitForMessageInTree(api, 'all-msg-b-to-c');
    await waitForMessageInTree(api, 'all-msg-c-to-a');
    await waitForMessageInTree(api, 'all-broadcast-from-a');
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
    await waitForAgentGone(api, a.name);
    await waitForAgentGone(api, b.name);
    await waitForAgentGone(api, c.name);
    await waitForLockGone(api, '/all/a1.ts');
    await waitForLockGone(api, '/all/b1.ts');
    await waitForCondition(() => api.getMessageCount() === 0, 'all messages to drain');

    // AFTER — every assertion that can possibly fire, fires.
    dumpTree('AGENTS-after-all', api.getAgentsTreeSnapshot());
    dumpTree('LOCKS-after-all', api.getLocksTreeSnapshot());
    dumpTree('MESSAGES-after-all', api.getMessagesTreeSnapshot());

    assertEqual(api.getAgentCount(), 0, 'after: zero agents');
    assertEqual(api.findAgentInTree(a.name), null, 'after: a gone from tree');
    assertEqual(api.findAgentInTree(b.name), null, 'after: b gone from tree');
    assertEqual(api.findAgentInTree(c.name), null, 'after: c gone from tree');
    assertEqual(api.getLockCount(), 0, 'after: zero locks');
    assertEqual(api.findLockInTree('/all/a1.ts'), null);
    assertEqual(api.findLockInTree('/all/a2.ts'), null);
    assertEqual(api.findLockInTree('/all/b1.ts'), null);
    assertEqual(api.findLockInTree('/all/c1.ts'), null);
    assertEqual(api.getPlans().length, 0, 'after: zero plans');
    assertEqual(api.getMessageCount(), 0, 'after: zero messages');
    assertEqual(api.findMessageInTree('all-msg-a-to-b'), null);
    assertEqual(api.findMessageInTree('all-msg-b-to-c'), null);
    assertEqual(api.findMessageInTree('all-msg-c-to-a'), null);
    assertEqual(api.findMessageInTree('all-broadcast-from-a'), null);

    // The broadcast sentinel '*' must NOT be visible as a deletable agent in
    // the UI, and the tree count must reflect that.
    assertEqual(api.findAgentInTree('*'), null, 'after: broadcast sentinel never appears as an agent');

    // Re-registering after a full wipe must still work — and broadcasts must
    // still work, which proves the '*' sentinel survived the delete-all.
    const fresh = await register('after-wipe');
    await waitForAgentInTree(api, fresh.name);
    await sendMessage(fresh, '*', 'after-wipe-broadcast');
    await waitForMessageInTree(api, 'after-wipe-broadcast');
    assertEqual(api.getAgentCount(), 1, 'post-wipe: 1 fresh agent');
    assertEqual(api.getMessageCount(), 1, 'post-wipe: 1 broadcast message');
    assertOk(api.findMessageInTree('after-wipe-broadcast') !== null, 'post-wipe: broadcast lands');
  });
});
