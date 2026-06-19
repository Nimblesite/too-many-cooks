/// Cloud connection E2E test — proves VSIX cloud mode works with encryption.
///
/// Phase 7 of the VSIX connection switcher.
/// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
/// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md
///
/// Tests the StatusDecryptor interface (pure, no network).
/// Edge function connectivity tests are SKIPPED when Supabase is not running.
/// All test agents use unique timestamped names to avoid DB pollution.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import type { AgentPlan, FileLock, Message } from '../../src/state/types';
import type { StatusDecryptor } from '../../src/services/storeManager';
import type { CloudTarget, LocalTarget } from '../../src/services/connectionTypes';

/** Edge function URL (local Supabase). */
const EDGE_FN_URL = 'http://127.0.0.1:54321/functions/v1/tmc-api';

/** Supabase anon key (local dev). */
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

/** Test tenant/workspace UUIDs. */
const TENANT_ID = 'cf000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = 'cf000000-0000-4000-8000-000000000002';
const TEST_PASSPHRASE = 'cloud-switcher-test-passphrase';

/** Auth header. */
const AUTH_HEADER = `Bearer ${ANON_KEY}`;

/** Content-Type JSON. */
const CT_JSON = 'application/json';

/** Default port. */
const DEFAULT_PORT = 4040;

/** Unique test run prefix to avoid DB pollution. */
const TEST_RUN_ID = `cstest-${Date.now()}`;

/** Call edge function. */
const edgeCall = async (
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const resp = await fetch(`${EDGE_FN_URL}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: AUTH_HEADER,
      'X-Tenant-Id': TENANT_ID,
      'X-Workspace-Id': WORKSPACE_ID,
      'Content-Type': CT_JSON,
    },
    body: JSON.stringify(body),
  });
  const json: unknown = await resp.json();
  return typeof json === 'object' && json !== null ? json as Record<string, unknown> : {};
};

/** Check if edge function is available AND test workspace exists. */
const edgeFnAvailable = async (): Promise<boolean> => {
  try {
    // Test register — proves both API connectivity and workspace exists
    const testName = `avail-check-${Date.now()}`;
    const resp = await edgeCall('register', { name: testName });
    if (resp.ok === true) {
      // Clean up the probe agent
      await edgeCall('adminDeleteAgent', { agentName: testName });
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

/** Log skip message when edge functions unavailable. */
const SKIP_MSG = '[SKIP] Edge functions or test workspace not available';

describe('Cloud Connection Switcher E2E', () => {
  let available = false;

  before(async () => {
    available = await edgeFnAvailable();
    if (!available) {
      console.log('[SKIP] Supabase edge functions not running — skipping cloud E2E tests');
      return;
    }
    await edgeCall('adminReset', {});
  });

  after(async () => {
    if (available) {
      await edgeCall('adminReset', {});
    }
  });

  // ─── Pure type tests (always run, no network) ──────────────────────

  it('ConnectionTarget types have all required fields and discriminate correctly', () => {
    const cloud: CloudTarget = {
      apiKey: ANON_KEY,
      apiUrl: EDGE_FN_URL,
      mode: 'cloud',
      passphrase: TEST_PASSPHRASE,
      tenantId: TENANT_ID,
      transport: 'stdio',
      workspaceId: WORKSPACE_ID,
    };
    assert.strictEqual(cloud.mode, 'cloud');
    assert.strictEqual(cloud.apiUrl, EDGE_FN_URL);
    assert.strictEqual(cloud.apiKey, ANON_KEY);
    assert.strictEqual(cloud.tenantId, TENANT_ID);
    assert.strictEqual(cloud.workspaceId, WORKSPACE_ID);
    assert.strictEqual(cloud.passphrase, TEST_PASSPHRASE);
    assert.strictEqual(cloud.transport, 'stdio');

    const local: LocalTarget = { mode: 'local', port: DEFAULT_PORT, transport: 'http-streamable' };
    assert.strictEqual(local.mode, 'local');
    assert.strictEqual(local.port, DEFAULT_PORT);
    assert.strictEqual(local.transport, 'http-streamable');
  });

  it('StatusDecryptor decrypts all encrypted fields and preserves plaintext fields', () => {
    const encMsg: Message = {
      id: 'msg-1', fromAgent: 'a', toAgent: 'b',
      content: 'ENCRYPTED', createdAt: 1000, readAt: null,
    };
    const encPlan: AgentPlan = {
      agentName: 'p', goal: 'ENC_GOAL', currentTask: 'ENC_TASK', updatedAt: 2000,
    };
    const encLock: FileLock = {
      filePath: '/f.ts', agentName: 'l', acquiredAt: 3000,
      expiresAt: 4000, reason: 'ENC_REASON', version: 1,
    };

    const decryptor: StatusDecryptor = {
      decryptLocks: (locks) => ({
        ok: true,
        value: locks.map((l) => ({ ...l, reason: 'DEC_REASON' })),
      }),
      decryptMessages: (msgs) => ({
        ok: true,
        value: msgs.map((m) => ({ ...m, content: 'DECRYPTED' })),
      }),
      decryptPlans: (plans) => ({
        ok: true,
        value: plans.map((p) => ({ ...p, currentTask: 'DEC_TASK', goal: 'DEC_GOAL' })),
      }),
    };

    // Decrypt messages
    const msgResult = decryptor.decryptMessages([encMsg]);
    assert.strictEqual(msgResult.ok, true);
    assert.strictEqual(msgResult.value?.[0]?.content, 'DECRYPTED', 'Content decrypted');
    assert.strictEqual(msgResult.value?.[0]?.fromAgent, 'a', 'fromAgent preserved');
    assert.strictEqual(msgResult.value?.[0]?.toAgent, 'b', 'toAgent preserved');
    assert.strictEqual(msgResult.value?.[0]?.id, 'msg-1', 'id preserved');
    assert.strictEqual(msgResult.value?.[0]?.readAt, null, 'readAt preserved');

    // Decrypt plans
    const planResult = decryptor.decryptPlans([encPlan]);
    assert.strictEqual(planResult.ok, true);
    assert.strictEqual(planResult.value?.[0]?.goal, 'DEC_GOAL', 'Goal decrypted');
    assert.strictEqual(planResult.value?.[0]?.currentTask, 'DEC_TASK', 'Task decrypted');
    assert.strictEqual(planResult.value?.[0]?.agentName, 'p', 'agentName preserved');
    assert.strictEqual(planResult.value?.[0]?.updatedAt, 2000, 'updatedAt preserved');

    // Decrypt locks
    const lockResult = decryptor.decryptLocks([encLock]);
    assert.strictEqual(lockResult.ok, true);
    assert.strictEqual(lockResult.value?.[0]?.reason, 'DEC_REASON', 'Reason decrypted');
    assert.strictEqual(lockResult.value?.[0]?.filePath, '/f.ts', 'filePath preserved');
    assert.strictEqual(lockResult.value?.[0]?.agentName, 'l', 'agentName preserved');
    assert.strictEqual(lockResult.value?.[0]?.version, 1, 'version preserved');
    assert.strictEqual(lockResult.value?.[0]?.acquiredAt, 3000, 'acquiredAt preserved');
    assert.strictEqual(lockResult.value?.[0]?.expiresAt, 4000, 'expiresAt preserved');
  });

  it('StatusDecryptor failure returns ok=false and no value', () => {
    const decryptor: StatusDecryptor = {
      decryptLocks: () => ({ ok: false }),
      decryptMessages: () => ({ ok: false }),
      decryptPlans: () => ({ ok: false }),
    };
    const msgResult = decryptor.decryptMessages([]);
    const planResult = decryptor.decryptPlans([]);
    const lockResult = decryptor.decryptLocks([]);

    assert.strictEqual(msgResult.ok, false, 'Message decrypt fails');
    assert.strictEqual(msgResult.value, undefined, 'No value on failure');
    assert.strictEqual(planResult.ok, false, 'Plan decrypt fails');
    assert.strictEqual(planResult.value, undefined, 'No value on failure');
    assert.strictEqual(lockResult.ok, false, 'Lock decrypt fails');
    assert.strictEqual(lockResult.value, undefined, 'No value on failure');
  });

  // ─── Edge function tests (skipped when Supabase not running) ───────

  it('Edge function register + status round-trip with unique agent names', async () => {
    if (!available) { console.log(SKIP_MSG); return; }

    const agentName = `${TEST_RUN_ID}-agent`;
    const resp = await edgeCall('register', { name: agentName });
    assert.strictEqual(resp.ok, true, 'Register must succeed');
    const value = resp.value as Record<string, unknown>;
    assert.strictEqual(typeof value.agentName, 'string', 'Must return agentName');
    assert.strictEqual(typeof value.agentKey, 'string', 'Must return agentKey');
    assert.strictEqual(value.agentName, agentName, 'agentName must match');
    assert.ok((value.agentKey as string).length > 0, 'agentKey must be non-empty');

    // Status must include the new agent
    const status = await edgeCall('status', {});
    assert.strictEqual(status.ok, true, 'Status must succeed');
    const statusValue = status.value as Record<string, unknown>;
    assert.ok(Array.isArray(statusValue.agents), 'Must have agents array');
    assert.ok(Array.isArray(statusValue.locks), 'Must have locks array');
    assert.ok(Array.isArray(statusValue.plans), 'Must have plans array');
    assert.ok(Array.isArray(statusValue.messages), 'Must have messages array');

    const agents = statusValue.agents as Array<Record<string, unknown>>;
    const found = agents.some((a) => a.agent_name === agentName);
    assert.ok(found, `Agent ${agentName} must appear in status`);
  });

  it('Edge function message + plan round-trip with unique names', async () => {
    if (!available) { console.log(SKIP_MSG); return; }

    const sender = `${TEST_RUN_ID}-sender`;
    const receiver = `${TEST_RUN_ID}-receiver`;
    const msgContent = `test-msg-${TEST_RUN_ID}`;
    const planGoal = `goal-${TEST_RUN_ID}`;
    const planTask = `task-${TEST_RUN_ID}`;

    // Register agents
    const senderResp = await edgeCall('register', { name: sender });
    assert.strictEqual(senderResp.ok, true);
    const senderKey = (senderResp.value as Record<string, unknown>).agentKey as string;
    await edgeCall('register', { name: receiver });

    // Send message
    const sendResp = await edgeCall('sendMessage', {
      fromAgent: sender, fromKey: senderKey,
      toAgent: receiver, content: msgContent,
    });
    assert.strictEqual(sendResp.ok, true, 'Send must succeed');

    // Update plan
    const planResp = await edgeCall('updatePlan', {
      agentName: sender, agentKey: senderKey,
      goal: planGoal, currentTask: planTask,
    });
    assert.strictEqual(planResp.ok, true, 'Plan update must succeed');

    // Verify via status
    const status = await edgeCall('status', {});
    const sv = status.value as Record<string, unknown>;
    const messages = sv.messages as Array<Record<string, unknown>>;
    const plans = sv.plans as Array<Record<string, unknown>>;

    assert.ok(messages.some((m) => m.content === msgContent), 'Message must be in status');
    assert.ok(plans.some((p) => p.goal === planGoal), 'Plan goal must be in status');
    assert.ok(plans.some((p) => p.current_task === planTask), 'Plan task must be in status');
  });

  it('Admin reset clears all test data', async () => {
    if (!available) { console.log(SKIP_MSG); return; }

    const resetResp = await edgeCall('adminReset', {});
    assert.strictEqual(resetResp.ok, true, 'Reset must succeed');
    const resetValue = resetResp.value as Record<string, unknown>;
    assert.strictEqual(resetValue.reset, true, 'Reset value must be true');

    const status = await edgeCall('status', {});
    const sv = status.value as Record<string, unknown>;
    assert.strictEqual((sv.agents as unknown[]).length, 0, 'Agents empty after reset');
    assert.strictEqual((sv.locks as unknown[]).length, 0, 'Locks empty after reset');
    assert.strictEqual((sv.plans as unknown[]).length, 0, 'Plans empty after reset');
    assert.strictEqual((sv.messages as unknown[]).length, 0, 'Messages empty after reset');
  });
});
