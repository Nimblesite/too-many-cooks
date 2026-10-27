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
import { makeCloudTarget, makeFileLock, makeLocalTarget, makeMessage, makePlan, requireRecord } from './testSupport';

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
async function edgeCall(
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
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
}

/** Check if edge function is available AND test workspace exists. */
async function edgeFnAvailable(): Promise<boolean> {
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
}

/** Log skip message when edge functions unavailable. */
const SKIP_MSG = '[SKIP] Edge functions or test workspace not available';

/** Shape every StatusDecryptor method returns. */
interface DecryptOutcome<T> {
  readonly ok: boolean;
  readonly value?: readonly T[];
}

/**
 * Assert a decrypt result succeeded and return its first element.
 * [SWITCHER-CLOUD-DECRYPT] All three decryptor methods share this contract.
 */
function requireDecrypted<T>(result: DecryptOutcome<T>, label: string): T {
  assert.strictEqual(result.ok, true, `${label} decrypt must succeed`);
  const first: T | undefined = result.value?.[0];
  if (first === undefined) { throw new Error(`${label} decrypt returned no value`); }
  return first;
}

/** Require a string field on a JSON record. */
function requireStringField(record: Record<string, unknown>, key: string): string {
  const value: unknown = record[key];
  if (typeof value !== 'string') { throw new Error(`Expected string field: ${key}`); }
  return value;
}

/** Every status record holds these arrays. */
const STATUS_ARRAY_FIELDS: readonly string[] = ['agents', 'locks', 'plans', 'messages'];

/** Assert each named field of a status record is an array. */
function assertStatusArrays(record: Record<string, unknown>): void {
  for (const key of STATUS_ARRAY_FIELDS) {
    assert.ok(Array.isArray(record[key]), `Must have ${key} array`);
  }
}

/** Read one status array as JSON records. */
function statusItems(record: Record<string, unknown>, key: string): readonly Record<string, unknown>[] {
  const value: unknown = record[key];
  if (!Array.isArray(value)) { throw new Error(`Expected ${key} array`); }
  const items: Record<string, unknown>[] = [];
  value.forEach((entry: unknown): void => { items.push(requireRecord(entry, key)); });
  return items;
}

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
    const cloud: CloudTarget = makeCloudTarget({
      apiKey: ANON_KEY,
      apiUrl: EDGE_FN_URL,
      passphrase: TEST_PASSPHRASE,
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
    });
    assert.strictEqual(cloud.mode, 'cloud');
    assert.strictEqual(cloud.apiUrl, EDGE_FN_URL);
    assert.strictEqual(cloud.apiKey, ANON_KEY);
    assert.strictEqual(cloud.tenantId, TENANT_ID);
    assert.strictEqual(cloud.workspaceId, WORKSPACE_ID);
    assert.strictEqual(cloud.passphrase, TEST_PASSPHRASE);
    assert.strictEqual(cloud.transport, 'stdio');

    const local: LocalTarget = makeLocalTarget();
    assert.strictEqual(local.mode, 'local');
    assert.strictEqual(local.port, DEFAULT_PORT);
    assert.strictEqual(local.transport, 'http-streamable');
  });

  it('StatusDecryptor decrypts all encrypted fields and preserves plaintext fields', () => {
    const encMsg: Message = makeMessage({
      id: 'msg-1', fromAgent: 'a', toAgent: 'b',
      content: 'ENCRYPTED', createdAt: 1000,
    });
    const encPlan: AgentPlan = makePlan({
      agentName: 'p', goal: 'ENC_GOAL', currentTask: 'ENC_TASK', updatedAt: 2000,
    });
    const encLock: FileLock = makeFileLock({
      filePath: '/f.ts', agentName: 'l', acquiredAt: 3000,
      expiresAt: 4000, reason: 'ENC_REASON',
    });

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
    const msg = requireDecrypted(decryptor.decryptMessages([encMsg]), 'Message');
    assert.strictEqual(msg.content, 'DECRYPTED', 'Content decrypted');
    assert.strictEqual(msg.fromAgent, 'a', 'fromAgent preserved');
    assert.strictEqual(msg.toAgent, 'b', 'toAgent preserved');
    assert.strictEqual(msg.id, 'msg-1', 'id preserved');
    assert.strictEqual(msg.readAt, null, 'readAt preserved');

    // Decrypt plans
    const plan = requireDecrypted(decryptor.decryptPlans([encPlan]), 'Plan');
    assert.strictEqual(plan.goal, 'DEC_GOAL', 'Goal decrypted');
    assert.strictEqual(plan.currentTask, 'DEC_TASK', 'Task decrypted');
    assert.strictEqual(plan.agentName, 'p', 'agentName preserved');
    assert.strictEqual(plan.updatedAt, 2000, 'updatedAt preserved');

    // Decrypt locks
    const lock = requireDecrypted(decryptor.decryptLocks([encLock]), 'Lock');
    assert.strictEqual(lock.reason, 'DEC_REASON', 'Reason decrypted');
    assert.strictEqual(lock.filePath, '/f.ts', 'filePath preserved');
    assert.strictEqual(lock.agentName, 'l', 'agentName preserved');
    assert.strictEqual(lock.version, 1, 'version preserved');
    assert.strictEqual(lock.acquiredAt, 3000, 'acquiredAt preserved');
    assert.strictEqual(lock.expiresAt, 4000, 'expiresAt preserved');
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
    const value = requireRecord(resp.value, 'register');
    assert.strictEqual(typeof value.agentName, 'string', 'Must return agentName');
    assert.strictEqual(typeof value.agentKey, 'string', 'Must return agentKey');
    assert.strictEqual(value.agentName, agentName, 'agentName must match');
    assert.ok(requireStringField(value, 'agentKey').length > 0, 'agentKey must be non-empty');

    // Status must include the new agent
    const status = await edgeCall('status', {});
    assert.strictEqual(status.ok, true, 'Status must succeed');
    const statusValue = requireRecord(status.value, 'status');
    assertStatusArrays(statusValue);

    const agents = statusItems(statusValue, 'agents');
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
    const senderKey = requireStringField(requireRecord(senderResp.value, 'register'), 'agentKey');
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
    const sv = requireRecord(status.value, 'status');
    const messages = statusItems(sv, 'messages');
    const plans = statusItems(sv, 'plans');

    assert.ok(messages.some((m) => m.content === msgContent), 'Message must be in status');
    assert.ok(plans.some((p) => p.goal === planGoal), 'Plan goal must be in status');
    assert.ok(plans.some((p) => p.current_task === planTask), 'Plan task must be in status');
  });

  it('Admin reset clears all test data', async () => {
    if (!available) { console.log(SKIP_MSG); return; }

    const resetResp = await edgeCall('adminReset', {});
    assert.strictEqual(resetResp.ok, true, 'Reset must succeed');
    const resetValue = requireRecord(resetResp.value, 'reset');
    assert.strictEqual(resetValue.reset, true, 'Reset value must be true');

    const status = await edgeCall('status', {});
    const sv = requireRecord(status.value, 'status');
    for (const key of STATUS_ARRAY_FIELDS) {
      assert.strictEqual(statusItems(sv, key).length, 0, `${key} empty after reset`);
    }
  });
});
