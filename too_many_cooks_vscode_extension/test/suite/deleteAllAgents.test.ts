// Delete All Agents: the view title button removes every registered agent.

import {
  waitForExtensionActivation,
  waitForConnection,
  waitForAgentInTree,
  waitForAgentGone,
  safeDisconnect,
  getTestAPI,
  callToolString,
  resetServerState,
  assertOk,
  assertEqual,
} from './testHelpers';

suite('Delete All Agents', () => {
  suiteSetup(async () => {
    await waitForExtensionActivation();
    const api = getTestAPI();
    if (!api.isConnected()) {
      await api.connect();
      await waitForConnection();
    }
    await resetServerState();
  });

  suiteTeardown(async () => {
    await safeDisconnect();
  });

  test('deleteAllAgents removes all registered agents', async () => {
    const api = getTestAPI();

    // 1. Register multiple agents
    const agentA = `all-delete-a-${Date.now()}`;
    const agentB = `all-delete-b-${Date.now()}`;
    const agentC = `all-delete-c-${Date.now()}`;

    const resultA = await callToolString(api, 'register', { name: agentA });
    assertOk(!resultA.includes('"error"'), `Register A failed: ${resultA}`);

    const resultB = await callToolString(api, 'register', { name: agentB });
    assertOk(!resultB.includes('"error"'), `Register B failed: ${resultB}`);

    const resultC = await callToolString(api, 'register', { name: agentC });
    assertOk(!resultC.includes('"error"'), `Register C failed: ${resultC}`);

    // 2. Verify all 3 agents appear in tree
    await waitForAgentInTree(api, agentA);
    await waitForAgentInTree(api, agentB);
    await waitForAgentInTree(api, agentC);
    assertOk(api.getAgentCount() >= 3, 'Should have at least 3 agents');

    // 3. Delete all agents
    await api.deleteAllAgents();

    // 4. Verify all agents are gone
    await waitForAgentGone(api, agentA);
    await waitForAgentGone(api, agentB);
    await waitForAgentGone(api, agentC);
    assertEqual(api.getAgentCount(), 0, 'All agents should be removed');
  });
});
