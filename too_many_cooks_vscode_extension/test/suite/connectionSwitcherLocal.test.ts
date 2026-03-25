// Connection Switcher E2E Tests — consolidated.
//
// Phase 7 of the VSIX connection switcher.
// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md
//
// FEWER TESTS, MORE ASSERTIONS. Every test proves multiple things.
// Proper cleanup via resetServerState in teardown.

import {
  waitForExtensionActivation,
  waitForConnection,
  waitForCondition,
  waitForAgentInTree,
  waitForLockInTree,
  waitForAgentGone,
  safeDisconnect,
  getTestAPI,
  callToolString,
  extractKeyFromResult,
  resetServerState,
  assertOk,
  assertEqual,
} from './testHelpers';

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** Unique run ID to avoid cross-run collisions. */
const RUN_ID: number = Date.now();
const PREFIX: string = `sw-${String(RUN_ID)}`;

/** Numeric constants. */
const ZERO = 0;
const ONE = 1;
const TWO = 2;

/** Shared helper: ensure connected and return API. */
async function ensureConnected() {
  const api = getTestAPI();
  if (!api.isConnected()) {
    await api.connect();
    await waitForConnection();
  }
  return api;
}

/** Shared helper: register agent and return key. */
async function registerAgent(name: string): Promise<string> {
  const api = getTestAPI();
  const result: string = await callToolString(api, 'register', { name });
  return extractKeyFromResult(result);
}

suite('Connection Switcher', () => {
  suiteSetup(async () => {
    await waitForExtensionActivation();
    await resetServerState();
  });

  suiteTeardown(async () => {
    await resetServerState();
    await safeDisconnect();
  });

  // ─── Test 1: Full VSIX lifecycle — register, lock, message, plan, release, trees ───

  test('Full local lifecycle: connect → register → lock → message → plan → release → disconnect → reconnect', async () => {
    const api = await ensureConnected();

    // ── Connection state ──
    assertOk(api.isConnected(), 'isConnected');
    assertEqual(api.getConnectionStatus(), 'connected', 'status');

    // ── Register two agents ──
    const a1: string = `${PREFIX}-a1`;
    const a2: string = `${PREFIX}-a2`;
    const k1: string = await registerAgent(a1);
    const k2: string = await registerAgent(a2);
    assertOk(k1.length > ZERO, 'agent 1 key non-empty');
    assertOk(k2.length > ZERO, 'agent 2 key non-empty');
    assertOk(k1 !== k2, 'keys must be unique');
    await waitForAgentInTree(api, a1);
    await waitForAgentInTree(api, a2);

    // Verify agent fields
    const agents = api.getAgents();
    const found1 = agents.find((a) => a.agentName === a1);
    assertOk(found1 !== undefined, 'agent 1 in state');
    assertOk(found1!.registeredAt > ZERO, 'registeredAt > 0');
    assertOk(found1!.lastActive > ZERO, 'lastActive > 0');
    assertOk(agents.some((a) => a.agentName === a2), 'agent 2 in state');

    // ── Acquire lock ──
    const lockFile: string = `/${PREFIX}/main.ts`;
    const lockResult: string = await callToolString(api, 'lock', {
      action: 'acquire', agent_key: k1, file_path: lockFile, reason: 'e2e test',
    });
    assertOk(lockResult.includes('true'), 'lock acquired');
    await waitForLockInTree(api, lockFile);
    const lock = api.getLocks().find((l) => l.filePath === lockFile);
    assertOk(lock !== undefined, 'lock in state');
    assertEqual(lock!.agentName, a1, 'lock owner');
    assertEqual(lock!.reason, 'e2e test', 'lock reason');
    assertOk(lock!.expiresAt > Date.now(), 'lock not expired');

    // ── Send message ──
    const msgContent: string = `msg-${String(RUN_ID)}`;
    await callToolString(api, 'message', {
      action: 'send', agent_key: k1, to_agent: a2, content: msgContent,
    });
    await waitForCondition(() => api.getMessages().some((m) => m.content === msgContent), 'message in state');
    const msg = api.getMessages().find((m) => m.content === msgContent);
    assertOk(msg !== undefined, 'message found');
    assertEqual(msg!.fromAgent, a1, 'msg from');
    assertEqual(msg!.toAgent, a2, 'msg to');
    assertOk(msg!.createdAt > ZERO, 'msg timestamp');

    // ── Update plan ──
    await callToolString(api, 'plan', {
      action: 'update', agent_key: k1, goal: 'e2e goal', current_task: 'e2e task',
    });
    await waitForCondition(() => api.getPlans().some((p) => p.agentName === a1), 'plan in state');
    const plan = api.getPlans().find((p) => p.agentName === a1);
    assertOk(plan !== undefined, 'plan found');
    assertEqual(plan!.goal, 'e2e goal', 'plan goal');
    assertEqual(plan!.currentTask, 'e2e task', 'plan task');

    // ── Release lock ──
    await callToolString(api, 'lock', { action: 'release', agent_key: k1, file_path: lockFile });
    await waitForCondition(() => !api.getLocks().some((l) => l.filePath === lockFile), 'lock gone');
    assertEqual(api.getLocks().filter((l) => l.filePath === lockFile).length, ZERO, 'lock removed from state');

    // ── Disconnect clears all client state ──
    const agentCountBefore: number = api.getAgents().length;
    assertOk(agentCountBefore >= TWO, 'agents before disconnect');
    await safeDisconnect();
    assertEqual(api.getConnectionStatus(), 'disconnected', 'disconnected status');
    assertOk(!api.isConnected(), 'isConnected false');
    assertEqual(api.getAgents().length, ZERO, 'agents cleared');
    assertEqual(api.getLocks().length, ZERO, 'locks cleared');
    assertEqual(api.getMessages().length, ZERO, 'messages cleared');
    assertEqual(api.getPlans().length, ZERO, 'plans cleared');
    assertEqual(api.getAgentsTreeSnapshot().length, ZERO, 'agents tree empty');

    // ── Reconnect restores server state ──
    await api.connect();
    await waitForConnection();
    assertEqual(api.getConnectionStatus(), 'connected', 'reconnected status');
    await waitForCondition(() => api.getAgents().length >= agentCountBefore, 'agents restored');
    assertEqual(api.getAgents().length, agentCountBefore, 'agent count preserved');
    assertOk(api.getAgents().some((a) => a.agentName === a1), 'agent 1 survived reconnect');
    assertOk(api.getAgents().some((a) => a.agentName === a2), 'agent 2 survived reconnect');
    assertOk(api.getPlans().some((p) => p.agentName === a1), 'plan survived reconnect');
    assertOk(api.getMessages().some((m) => m.content === msgContent), 'message survived reconnect');
  });

  // ─── Test 2: Disconnect/reconnect cycles + session recovery + admin ops ───

  test('Multi-cycle reconnect, stale session recovery, admin delete', async () => {
    const api = await ensureConnected();
    const agentName: string = `${PREFIX}-cycle`;
    const key: string = await registerAgent(agentName);
    await waitForAgentInTree(api, agentName);

    // Lock a file
    const lockFile: string = `/${PREFIX}/cycle.ts`;
    await callToolString(api, 'lock', {
      action: 'acquire', agent_key: key, file_path: lockFile, reason: 'cycle',
    });
    await waitForLockInTree(api, lockFile);

    const agentsBefore: number = api.getAgents().length;
    const locksBefore: number = api.getLocks().length;
    assertOk(agentsBefore >= ONE, 'agents before cycle');
    assertOk(locksBefore >= ONE, 'locks before cycle');

    // ── Cycle 1 ──
    await safeDisconnect();
    assertEqual(api.getAgents().length, ZERO, 'c1: agents cleared');
    assertEqual(api.getLocks().length, ZERO, 'c1: locks cleared');
    await api.connect();
    await waitForConnection();
    await waitForCondition(() => api.getAgents().length >= agentsBefore, 'c1: agents restore');
    assertEqual(api.getAgents().length, agentsBefore, 'c1: agent count');
    assertEqual(api.getLocks().length, locksBefore, 'c1: lock count');

    // ── Cycle 2 (idempotency) ──
    await safeDisconnect();
    await api.connect();
    await waitForConnection();
    await waitForCondition(() => api.getAgents().length >= agentsBefore, 'c2: agents restore');
    assertEqual(api.getAgents().length, agentsBefore, 'c2: agent count');
    assertOk(api.findLockInTree(lockFile) !== null, 'lock survived 2 cycles');
    assertOk(api.findAgentInTree(agentName) !== null, 'agent survived 2 cycles');

    // ── Stale MCP session recovery ──
    api.invalidateMcpSession();
    const planResult: string = await callToolString(api, 'plan', {
      action: 'update', agent_key: key, goal: 'session-recovery', current_task: 'testing',
    });
    assertOk(planResult.includes('true'), 'tool call after stale session');
    await api.refreshStatus();
    assertOk(api.getPlans().some((p) => p.goal === 'session-recovery'), 'plan stored after recovery');

    // ── SSE stream recovery ──
    api.invalidateEventStream();
    // Register new agent — SSE push should trigger refresh after stream recovers
    const a3: string = `${PREFIX}-sse`;
    await registerAgent(a3);
    await waitForAgentInTree(api, a3);
    assertOk(api.getAgents().some((a) => a.agentName === a3), 'agent via SSE recovery');

    // ── Admin delete after reconnect ──
    await api.deleteAgent(agentName);
    await waitForAgentGone(api, agentName);
    assertOk(!api.getAgents().some((a) => a.agentName === agentName), 'agent deleted from state');
    assertOk(api.findAgentInTree(agentName) === null, 'agent deleted from tree');
    // Lock should also be gone (cascade)
    await waitForCondition(() => !api.getLocks().some((l) => l.filePath === lockFile), 'lock cascade deleted');
  });

  // ─── Test 3: StoreManager setTarget + getConnectionMode integration ───

  test('StoreManager setTarget changes baseUrl and getConnectionMode reflects state', async () => {
    const api = await ensureConnected();

    // getConnectionMode should reflect connected local mode
    // (default port constructor = local-like connection)
    assertEqual(api.getConnectionStatus(), 'connected', 'connected');

    // setTarget to a local target and verify it doesn't break existing connection
    // (StoreManager.setTarget just reconfigures URL, doesn't reconnect)
    const sm = api.getStoreManager();
    sm.setTarget({ mode: 'local', port: 4040, transport: 'http-streamable' });
    assertEqual(sm.getConnectionMode(), 'local', 'mode is local');
    const target = sm.getTarget();
    assertOk(target !== null, 'target not null');
    assertEqual(target!.mode, 'local', 'target mode');
    assertEqual(target!.transport, 'http-streamable', 'target transport');

    // Disconnect clears target
    sm.disconnect();
    assertEqual(sm.getConnectionMode(), 'disconnected', 'mode after disconnect');
    assertEqual(sm.getTarget(), null, 'target null after disconnect');

    // Reconnect works after setTarget
    sm.setTarget({ mode: 'local', port: 4040, transport: 'http-streamable' });
    await sm.connect();
    await waitForConnection();
    assertEqual(sm.getConnectionMode(), 'local', 'mode after reconnect');
    assertOk(sm.getTarget() !== null, 'target restored');
    assertOk(api.getAgents().length > ZERO, 'agents after setTarget reconnect');
  });

  // ─── Test 4: MCP Config Manager — detect, write HTTP, write stdio, remove ───

  test('MCP Config Manager: HTTP write, stdio overwrite, remove, preserves other servers', async () => {
    const wsFolder: string = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    const claudeDir: string = path.join(wsFolder, '.claude');
    const mcpConfigPath: string = path.join(wsFolder, '.mcp.json');

    const createdClaudeDir: boolean = !fs.existsSync(claudeDir);
    if (createdClaudeDir) { fs.mkdirSync(claudeDir, { recursive: true }); }

    let originalConfig: string | null = null;
    if (fs.existsSync(mcpConfigPath)) { originalConfig = fs.readFileSync(mcpConfigPath, 'utf-8'); }

    try {
      const { createMcpConfigManager } = await import('../../src/services/mcpConfigManager');
      const logs: string[] = [];
      const mgr = createMcpConfigManager(wsFolder, (m: string) => { logs.push(m); });

      // ── Detect ──
      const agents = mgr.detectAgents();
      assertOk(agents.length >= ONE, 'detected agents');
      assertOk(agents.includes('claude-code'), 'claude-code detected');

      // ── Seed existing server to prove we preserve it ──
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: { 'other-mcp': { url: 'http://other:9999' } },
      }));

      // ── Write HTTP config ──
      mgr.writeHttpStreamableConfig(agents, 4040);
      const httpJson = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
      assertEqual(httpJson.mcpServers['too-many-cooks'].url, 'http://localhost:4040/mcp', 'http url');
      assertEqual(httpJson.mcpServers['other-mcp'].url, 'http://other:9999', 'other preserved after http write');
      assertOk(logs.some((l) => l.includes('claude-code')), 'log mentions agent');

      // ── Overwrite with stdio ──
      mgr.writeStdioConfig(agents, { apiKey: 'k', workspaceId: 'w', passphrase: 'p' });
      const stdioJson = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
      const tmc = stdioJson.mcpServers['too-many-cooks'];
      assertEqual(tmc.command, 'npx', 'stdio command');
      assertOk(Array.isArray(tmc.args), 'stdio args array');
      assertEqual(tmc.env.TMC_API_KEY, 'k', 'stdio api key');
      assertEqual(tmc.env.TMC_WORKSPACE_ID, 'w', 'stdio workspace id');
      assertEqual(tmc.env.TMC_WORKSPACE_SECRET, 'p', 'stdio passphrase');
      assertOk(tmc.url === undefined, 'http url gone after stdio overwrite');
      assertEqual(stdioJson.mcpServers['other-mcp'].url, 'http://other:9999', 'other preserved after stdio write');

      // ── Remove ──
      mgr.removeConfig(agents);
      const afterRemove = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
      assertEqual(afterRemove.mcpServers['too-many-cooks'], undefined, 'tmc removed');
      assertEqual(afterRemove.mcpServers['other-mcp'].url, 'http://other:9999', 'other preserved after remove');

      // ── getConfigPath ──
      assertOk(mgr.getConfigPath('claude-code').endsWith('.mcp.json'), 'claude path');
      assertOk(mgr.getConfigPath('cursor').includes('.cursor'), 'cursor path');
      assertOk(mgr.getConfigPath('cline').includes('.cline'), 'cline path');
      assertOk(mgr.getConfigPath('codex').includes('.codex'), 'codex path');
    } finally {
      if (originalConfig !== null) {
        fs.writeFileSync(mcpConfigPath, originalConfig, 'utf-8');
      } else if (fs.existsSync(mcpConfigPath)) {
        fs.unlinkSync(mcpConfigPath);
      }
      if (createdClaudeDir) { fs.rmSync(claudeDir, { recursive: true, force: true }); }
    }
  });
});
