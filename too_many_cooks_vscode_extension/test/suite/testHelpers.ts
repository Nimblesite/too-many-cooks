// Test helpers for VSCode Extension Host integration tests.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { TestAPI, TreeItemSnapshot } from '../../src/testApi';
import type { FileLock } from '../../src/state/types';
import { AgentTreeItem } from '../../src/ui/tree/agentTreeItem';
import { LockTreeItem } from '../../src/ui/tree/lockTreeItem';
import { makeFileLock } from '../pure/testSupport';

const EXTENSION_ID = 'Nimblesite.too-many-cooks';
const CI_TIMEOUT_MULTIPLIER = process.env.CI ? 10 : 1;
const EVENT_TIMEOUT_MS = 1000 * CI_TIMEOUT_MULTIPLIER;
const EVENT_POLL_MS = 50;

let cachedTestAPI: TestAPI | null = null;

// ============================================================================
// Core helpers
// ============================================================================

export function getTestAPI(): TestAPI {
  if (!cachedTestAPI) {
    throw new Error('Test API not initialized - call waitForExtensionActivation first');
  }
  return cachedTestAPI;
}

export async function waitForCondition(
  condition: () => boolean,
  message = 'Condition not met within timeout',
  timeout = EVENT_TIMEOUT_MS,
  interval = EVENT_POLL_MS,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (condition()) { return; }
    await delay(interval);
  }
  throw new Error(`Timeout: ${message}`);
}

export async function waitForExtensionActivation(): Promise<void> {
  console.log('[TEST HELPER] Starting extension activation wait...');

  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  if (!ext) {
    throw new Error(`Extension not found: ${EXTENSION_ID}`);
  }

  if (!ext.isActive) {
    await ext.activate();
  }

  const exports = ext.exports as TestAPI | undefined;
  if (exports) {
    cachedTestAPI = exports;
    console.log('[TEST HELPER] Test API verified immediately');
  } else {
    await waitForCondition(() => {
      const exp = ext.exports as TestAPI | undefined;
      if (exp) {
        cachedTestAPI = exp;
        return true;
      }
      return false;
    }, 'Extension exports not available within timeout', EVENT_TIMEOUT_MS);
  }

  console.log('[TEST HELPER] Extension activation complete');
}

/** Activate the extension and ensure it is connected to the server. */
export async function activateAndConnect(): Promise<TestAPI> {
  await waitForExtensionActivation();
  const api = getTestAPI();
  if (!api.isConnected()) {
    await api.connect();
    await waitForConnection();
  }
  return api;
}

/** Activate, drop any stale session, and reconnect fresh. */
export async function reconnectFresh(): Promise<TestAPI> {
  await waitForExtensionActivation();
  await safeDisconnect();
  const api = getTestAPI();
  await api.connect();
  await waitForConnection();
  return api;
}

/** Activate, connect, and wipe server state so tests start clean. */
export async function ensureServerReady(): Promise<TestAPI> {
  const api = await activateAndConnect();
  await resetServerState();
  return api;
}

// ============================================================================
// Direct MCP HTTP helpers (bypass the VSIX StoreManager)
// ============================================================================

import { isRecord } from '../../src/services/httpClient';
import { initMcpSession } from '../../src/services/mcpProtocol';

const SSE_ACCEPT: string = 'application/json, text/event-stream';
const CONTENT_TYPE_JSON: string = 'application/json';
const SESSION_ID_HEADER: string = 'mcp-session-id';
const DATA_LINE_PREFIX: string = 'data: ';

export const MCP_ENDPOINT: string = '/mcp';

/** Open a raw MCP session against any endpoint (init + initialized handshake). */
export async function initDirectMcpSession(
  baseUrl: string,
  endpoint: string,
  clientName: string,
): Promise<string> {
  return await initMcpSession(baseUrl, endpoint, clientName);
}

/** Extract the first result.content[0].text string from a JSON value, or null. */
function extractResultText(value: unknown): string | null {
  if (!isRecord(value)) { return null; }
  const result = value['result'];
  if (!isRecord(result)) { return null; }
  const content = result['content'];
  if (!Array.isArray(content)) { return null; }
  const first: unknown = content[0];
  if (!isRecord(first)) { return null; }
  const text = first['text'];
  return typeof text === 'string' ? text : null;
}

/** Parse a JSON string and return the first tool-result text, or null. */
function parseJsonToolText(input: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }
  return extractResultText(parsed);
}

/** Extract the first tool-result text from a Streamable HTTP / JSON response. */
function parseToolCallText(text: string): string {
  const lines: readonly string[] = text.split('\n').filter(
    (l: string): boolean => { return l.startsWith(DATA_LINE_PREFIX); },
  );
  if (lines.length > 0) {
    const data: string = lines.map((l: string): string => { return l.substring(DATA_LINE_PREFIX.length).trim(); }).join('');
    const fromData = parseJsonToolText(data);
    if (fromData !== null) { return fromData; }
  }
  const fromBody = parseJsonToolText(text);
  return fromBody ?? text;
}

/** Direct tools/call over raw HTTP — bypasses VSIX callTool and its refreshStatus(). */
export async function directToolCall(
  baseUrl: string,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const body = JSON.stringify({
    id: Date.now(),
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { arguments: args, name: toolName },
  });
  const response = await fetch(`${baseUrl}${MCP_ENDPOINT}`, {
    body,
    headers: {
      'accept': SSE_ACCEPT,
      'content-type': CONTENT_TYPE_JSON,
      [SESSION_ID_HEADER]: sessionId,
    },
    method: 'POST',
  });
  const text = await response.text();
  return parseToolCallText(text);
}

export async function waitForConnection(timeout = EVENT_TIMEOUT_MS): Promise<void> {
  console.log('[TEST HELPER] Waiting for connection...');
  const api = getTestAPI();
  await waitForCondition(
    () => api.isConnected(),
    'Connection timed out',
    timeout,
  );
  console.log('[TEST HELPER] Connection established');
}

export async function safeDisconnect(): Promise<void> {
  if (!cachedTestAPI) { return; }
  if (cachedTestAPI.isConnected()) {
    try { await cachedTestAPI.disconnect(); } catch { /* ignore */ }
  }
  console.log('[TEST HELPER] Safe disconnect complete');
}

// ============================================================================
// Wait-for-tree helpers
// ============================================================================

export async function waitForLockInTree(
  api: TestAPI,
  filePath: string,
  timeout = EVENT_TIMEOUT_MS,
  interval = EVENT_POLL_MS,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (api.findLockInTree(filePath)) { return; }
    await delay(interval);
  }
  throw new Error(`Timeout: Lock to appear: ${filePath}`);
}

export async function waitForLockGone(
  api: TestAPI,
  filePath: string,
  timeout = EVENT_TIMEOUT_MS,
  interval = EVENT_POLL_MS,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!api.findLockInTree(filePath)) { return; }
    await delay(interval);
  }
  throw new Error(`Timeout: Lock to disappear: ${filePath}`);
}

export async function waitForAgentInTree(
  api: TestAPI,
  agentName: string,
  timeout = EVENT_TIMEOUT_MS,
  interval = EVENT_POLL_MS,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (api.findAgentInTree(agentName)) { return; }
    await delay(interval);
  }
  throw new Error(`Timeout: Agent to appear: ${agentName}`);
}

export async function waitForAgentGone(
  api: TestAPI,
  agentName: string,
  timeout = EVENT_TIMEOUT_MS,
  interval = EVENT_POLL_MS,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!api.findAgentInTree(agentName)) { return; }
    await delay(interval);
  }
  throw new Error(`Timeout: Agent to disappear: ${agentName}`);
}

export async function waitForMessageInTree(
  api: TestAPI,
  content: string,
  timeout = EVENT_TIMEOUT_MS,
  interval = EVENT_POLL_MS,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (api.findMessageInTree(content)) { return; }
    await delay(interval);
  }
  throw new Error(`Timeout: Message to appear: ${content}`);
}

/** Acquire a lock via the test API and wait for it to appear in the tree. */
export async function acquireLockAndWait(
  api: TestAPI,
  agentName: string,
  agentKey: string,
  filePath: string,
  reason: string,
): Promise<void> {
  await api.callTool('lock', {
    action: 'acquire',
    agent_key: agentKey,
    agent_name: agentName,
    file_path: filePath,
    reason,
  });
  await waitForLockInTree(api, filePath);
}

// ============================================================================
// Server state reset & database cleanup
// ============================================================================

/** Port of the suite's server; scripts/testServer.js always sets TMC_PORT. */
export const TEST_PORT = process.env.TMC_PORT ?? '4040';
const TEST_BASE_URL = `http://localhost:${TEST_PORT}`;

export async function resetServerState(): Promise<void> {
  console.log('[TEST HELPER] Resetting server state via /admin/reset');
  const response = await fetch(`${TEST_BASE_URL}/admin/reset`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Failed to reset server: ${response.status} ${response.statusText}`);
  }
  console.log('[TEST HELPER] Server state reset');
}

export function cleanDatabase(): void {
  const folders = vscode.workspace.workspaceFolders;
  const first = folders && folders.length > 0 ? folders[0] : undefined;
  const wsFolder = first ? first.uri.fsPath : '.';
  const dbDir = path.join(wsFolder, '.too_many_cooks');

  console.log(`[TEST HELPER] Cleaning database at: ${dbDir}`);

  for (const f of ['data.db', 'data.db-wal', 'data.db-shm']) {
    try {
      fs.unlinkSync(path.join(dbDir, f));
    } catch { /* ignore if doesn't exist */ }
  }

  console.log('[TEST HELPER] Database cleaned');
}

// ============================================================================
// Dialog mocking via DialogService (not monkey-patching vscode.window)
// ============================================================================

import { getDialogService, resetDialogService, setDialogService } from '../../src/services/dialogService';
import type { DialogService } from '../../src/services/dialogService';

let mocksInstalled = false;

const warningMessageResponses: (string | undefined)[] = [];
const quickPickResponses: (string | undefined)[] = [];
const inputBoxResponses: (string | undefined)[] = [];
const shownErrorMessages: string[] = [];
const shownInformationMessages: string[] = [];
const shownWarningMessages: string[] = [];

/** Push one canned dialog answer onto its queue. */
function queueAnswer(queue: (string | undefined)[], response: string | undefined): void {
  queue.push(response);
}

export function mockWarningMessage(response: string | undefined): void { queueAnswer(warningMessageResponses, response); }

export function mockQuickPick(response: string | undefined): void { queueAnswer(quickPickResponses, response); }

export function mockInputBox(response: string | undefined): void { queueAnswer(inputBoxResponses, response); }

export function installDialogMocks(): void {
  if (mocksInstalled) { return; }

  setDialogService({
    showErrorMessage: async (message: string): Promise<string | undefined> => {
      shownErrorMessages.push(message);
      console.log(`[MOCK] showErrorMessage: ${message}`);
      return undefined;
    },
    showInformationMessage: async (message: string): Promise<string | undefined> => {
      shownInformationMessages.push(message);
      console.log(`[MOCK] showInformationMessage: ${message}`);
      return undefined;
    },
    showInputBox: async (): Promise<string | undefined> => {
      const val = inputBoxResponses.shift();
      console.log(`[MOCK] showInputBox returning: ${val}`);
      return val;
    },
    showQuickPick: async (): Promise<string | undefined> => {
      const val = quickPickResponses.shift();
      console.log(`[MOCK] showQuickPick returning: ${val}`);
      return val;
    },
    showWarningMessage: async (message: string): Promise<string | undefined> => {
      shownWarningMessages.push(message);
      const val = warningMessageResponses.shift();
      console.log(`[MOCK] showWarningMessage returning: ${val}`);
      return val;
    },
  });

  mocksInstalled = true;
  console.log('[TEST HELPER] Dialog mocks installed');
}

export function restoreDialogMocks(): void {
  if (!mocksInstalled) { return; }

  resetDialogService();

  shownErrorMessages.length = 0;
  shownInformationMessages.length = 0;
  shownWarningMessages.length = 0;
  warningMessageResponses.length = 0;
  quickPickResponses.length = 0;
  inputBoxResponses.length = 0;
  mocksInstalled = false;
  console.log('[TEST HELPER] Dialog mocks restored');
}

// ============================================================================
// Shown-dialog assertions (recorded by the installed mocks)
// ============================================================================

export function getShownErrorMessages(): readonly string[] {
  return [...shownErrorMessages];
}

export function getShownInformationMessages(): readonly string[] {
  return [...shownInformationMessages];
}

export function getShownWarningMessages(): readonly string[] {
  return [...shownWarningMessages];
}

export function clearShownDialogMessages(): void {
  shownErrorMessages.length = 0;
  shownInformationMessages.length = 0;
  shownWarningMessages.length = 0;
}

function assertMessageListed(
  messages: readonly string[],
  fragment: string,
  kind: string,
): void {
  if (!messages.some((msg: string): boolean => msg.includes(fragment))) {
    throw new Error(
      `Expected ${kind} containing "${fragment}", shown: ${JSON.stringify(messages)}`,
    );
  }
}

export function assertShownErrorMessage(fragment: string): void {
  assertMessageListed(shownErrorMessages, fragment, 'error message');
}

export function assertShownInformationMessage(fragment: string): void {
  assertMessageListed(shownInformationMessages, fragment, 'information message');
}

export function assertShownWarningMessage(fragment: string): void {
  assertMessageListed(shownWarningMessages, fragment, 'warning message');
}

export function resetToDefaultDialogService(): void {
  resetDialogService();
}

export function getActiveDialogService(): DialogService {
  return getDialogService();
}

// ============================================================================
// Failure-path connection helpers
// ============================================================================

const UNREACHABLE_PORT = 1;

/** Disconnect and point the store manager at an unreachable local port. */
export async function pointAtUnreachablePort(api: TestAPI): Promise<void> {
  await api.disconnect();
  api.getStoreManager().setTarget({
    mode: 'local',
    port: UNREACHABLE_PORT,
    transport: 'http-streamable',
  });
}

/** Point back at the test server and reconnect. */
export async function reconnectToTestServer(api: TestAPI): Promise<void> {
  api.getStoreManager().setTarget({
    mode: 'local',
    port: Number(TEST_PORT),
    transport: 'http-streamable',
  });
  await api.connect();
  await waitForConnection();
}

// ============================================================================
// Tool call helper
// ============================================================================

export async function callToolString(
  api: TestAPI,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  return api.callTool(name, args);
}

/** Register an agent via the MCP tool and return its key. */
export async function registerAgent(api: TestAPI, name: string): Promise<string> {
  const result = await callToolString(api, 'register', { name });
  return extractKeyFromResult(result);
}

export function extractKeyFromResult(result: string): string {
  const match = /"agent_key"\s*:\s*"(?<key>[^"]+)"/u.exec(result);
  if (!match) {
    throw new Error(`Could not extract agent_key from result: ${result}`);
  }
  return match[1] ?? '';
}

// ============================================================================
// TreeItemSnapshot helpers
// ============================================================================

/** Narrow a found tree item to non-null, throwing when missing. */
export function requireTreeItem(
  item: TreeItemSnapshot | null | undefined,
  label: string,
): TreeItemSnapshot {
  if (typeof item === 'undefined' || item === null) {
    throw new Error(`Tree item not found: ${label}`);
  }
  return item;
}

export function getLabel(item: TreeItemSnapshot): string {
  return item.label ?? '';
}

const MESSAGE_ITEM_REQUIRED = 'msgItem must exist';

/** Find the tree row for a message content snippet, throwing when missing. */
export function requireMessageItem(api: TestAPI, content: string, missingMessage: string): TreeItemSnapshot {
  const item = api.findMessageInTree(content);
  assertOk(item, missingMessage);
  return requireTreeItem(item, MESSAGE_ITEM_REQUIRED);
}

/** Find the tree row for a message content snippet and return its label. */
export function requireMessageLabel(api: TestAPI, content: string, missingMessage: string): string {
  return getLabel(requireMessageItem(api, content, missingMessage));
}

/**
 * Assert a message row's label carries every fragment and its description the
 * given preview text, returning the row.
 * [TEST-MESSAGE-ROW] The messages tree contract every suite checks.
 */
export function assertMessageRow(
  api: TestAPI,
  snippet: string,
  labelFragments: readonly string[],
  descriptionFragment: string,
): TreeItemSnapshot {
  const item = requireMessageItem(api, snippet, `${snippet} MUST appear in tree`);
  const label = getLabel(item);
  for (const fragment of labelFragments) {
    assertOk(label.includes(fragment), `Label MUST contain "${fragment}", got: ${label}`);
  }
  const description = getDescription(item);
  assertOk(
    description.includes(descriptionFragment),
    `Description MUST contain "${descriptionFragment}", got: ${description}`,
  );
  return item;
}

/** Assert the agent row's plan child carries the goal label and task text. */
export function assertPlanChild(api: TestAPI, agentName: string, goalLabel: string, task: string): TreeItemSnapshot {
  const agentItem = api.findAgentInTree(agentName);
  assertOk(agentItem, `${agentName} MUST be in tree`);
  const row = requireTreeItem(agentItem, 'agentItem must exist');
  assertOk(getChildren(row), 'Agent should have children');

  const planChild = findChildByLabel(row, goalLabel);
  assertOk(planChild, `Plan goal "${goalLabel}" MUST appear in agent children`);

  const planRow = requireTreeItem(planChild, 'planChild must exist');
  const planDesc = getDescription(planRow);
  assertOk(planDesc.includes(task), `Plan description should contain task, got: ${planDesc}`);
  return planRow;
}

/** Send a broadcast message from an agent and wait for it in the messages tree. */
export async function sendBroadcastAndWait(
  api: TestAPI,
  agentName: string,
  agentKey: string,
  content: string,
  snippet: string,
): Promise<void> {
  await sendMessageToolCall(api, agentName, agentKey, '*', content);
  await waitForMessageInTree(api, snippet);
}

/** Assert a tree lookup found the item (present) or returned null (absent). */
export function assertTreePresence(
  found: TreeItemSnapshot | null,
  present: boolean,
  label: string,
): void {
  if (present) {
    assertOk(found, `${label} MUST be in tree`);
    return;
  }
  assertEqual(found, null, `${label} MUST NOT be in tree`);
}

/** Assert every item is found by `find` (present) or not found (absent). */
function assertRowsInTree<T>(
  items: readonly T[],
  find: (item: T) => TreeItemSnapshot | null,
  label: (item: T) => string,
  present: boolean,
): void {
  for (const item of items) {
    assertTreePresence(find(item), present, label(item));
  }
}

/** Assert every named agent is present in (or absent from) the agents tree. */
export function assertAgentsInTree(api: TestAPI, names: readonly string[], present: boolean): void {
  assertRowsInTree(names, (name: string): TreeItemSnapshot | null => api.findAgentInTree(name), (name: string): string => name, present);
}

/** Assert every file path is present in (or absent from) the locks tree. */
export function assertLocksInTree(api: TestAPI, filePaths: readonly string[], present: boolean): void {
  assertRowsInTree(filePaths, (filePath: string): TreeItemSnapshot | null => api.findLockInTree(filePath), (filePath: string): string => filePath, present);
}

/** Assert every content snippet is present in (or absent from) the messages tree. */
export function assertMessagesInTree(api: TestAPI, contents: readonly string[], present: boolean): void {
  assertRowsInTree(contents, (content: string): TreeItemSnapshot | null => api.findMessageInTree(content), (content: string): string => content, present);
}

/** Find the agent's tree row and assert its children carry the given text. */
export function requireAgentChild(api: TestAPI, agentName: string, text: string): TreeItemSnapshot {
  const item = api.findAgentInTree(agentName);
  assertOk(item, `${agentName} MUST be in tree`);
  const row = requireTreeItem(item, 'agentItem must exist');
  assertOk(hasChildWithLabel(row, text), `${agentName} children MUST include ${text}`);
  return row;
}

/** Wait until the agent's tree row has a child whose label contains `text`. */
export async function waitForAgentChild(
  api: TestAPI,
  agentName: string,
  text: string,
  message: string,
): Promise<void> {
  await waitForCondition(() => {
    const item = api.findAgentInTree(agentName);
    return typeof item === 'undefined' || item === null ? false : hasChildWithLabel(item, text);
  }, message);
}

/**
 * Run one async wait per item, sequentially.
 * [TEST-WAIT-EACH] Single implementation of the "wait for every row" loops.
 */
export async function waitForEach<T>(items: readonly T[], wait: (item: T) => Promise<void>): Promise<void> {
  for (const item of items) {
    await wait(item);
  }
}

export function getDescription(item: TreeItemSnapshot): string {
  return item.description ?? '';
}

export function getChildren(item: TreeItemSnapshot): readonly TreeItemSnapshot[] | undefined {
  return item.children;
}

export function hasChildWithLabel(item: TreeItemSnapshot, text: string): boolean {
  return item.children?.some(c => c.label.includes(text)) ?? false;
}

export function findChildByLabel(item: TreeItemSnapshot, text: string): TreeItemSnapshot | undefined {
  return item.children?.find(c => c.label.includes(text));
}

export function countChildrenMatching(
  item: TreeItemSnapshot,
  predicate: (child: TreeItemSnapshot) => boolean,
): number {
  return item.children?.filter(predicate).length ?? 0;
}

// ============================================================================
// Misc helpers
// ============================================================================

export async function openTooManyCooksPanel(): Promise<void> {
  await vscode.commands.executeCommand('workbench.view.extension.tooManyCooks');
}

export async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, ms); });
}

/** Dump the agents, locks, and messages trees under a shared label suffix. */
export function dumpAllTrees(api: TestAPI, label: string): void {
  dumpTree(`AGENTS-${label}`, api.getAgentsTreeSnapshot());
  dumpTree(`LOCKS-${label}`, api.getLocksTreeSnapshot());
  dumpTree(`MESSAGES-${label}`, api.getMessagesTreeSnapshot());
}

export function dumpTree(name: string, items: readonly TreeItemSnapshot[]): void {
  console.log(`\n=== ${name} TREE ===`);
  function dump(list: readonly TreeItemSnapshot[], indent: number): void {
    for (const item of list) {
      const prefix = '  '.repeat(indent);
      const desc = item.description ? ` [${item.description}]` : '';
      console.log(`${prefix}- ${item.label}${desc}`);
      if (item.children) { dump(item.children, indent + 1); }
    }
  }
  dump(items, 0);
  console.log('=== END ===\n');
}

// ============================================================================
// Messages tree leaf access (bridge for the black-box messagesTreeLeaf suite)
// ============================================================================

import { MessagesTreeProvider } from '../../src/ui/tree/messagesTreeProvider';

/** Root count plus first-item child count for the messages tree. */
export function messagesTreeLeafStats(api: TestAPI): readonly [number, number] {
  const provider: MessagesTreeProvider = new MessagesTreeProvider(api.getStoreManager());
  const root = provider.getChildren();
  const first = root[0];
  const rootCount: number = root.length;
  const firstChildCount: number = typeof first === 'undefined'
    ? -1
    : provider.getChildren(first).length;
  provider.dispose();
  return [rootCount, firstChildCount];
}

// ============================================================================
// Shared test-construction helpers
// ============================================================================

const UNIQUE_NAME_RANDOM_BOUND = 100000;

const AGENT_KEY_MISSING = 'Agent key unavailable - suite setup did not register an agent';

/** Obtains a connected TestAPI during suite setup. */
export type SuiteConnector = () => Promise<TestAPI>;

/** Suite-scoped agent identity with a key captured during suite setup. */
export interface AgentSuite {
  readonly agentName: string;
  readonly requireKey: () => string;
}

/**
 * Register a suite-scoped agent and disconnect it on suite teardown.
 * [TEST-SUITE-SESSION] Single implementation of the setup/teardown block that
 * agent-backed suites used to copy-paste.
 */
export function startAgentSuite(prefix: string, connect: SuiteConnector): AgentSuite {
  const agentName = uniqueName(prefix);
  let captured: string | undefined;
  suiteSetup(async () => {
    captured = await registerAgent(await connect(), agentName);
  });
  suiteTeardown(async () => { await safeDisconnect(); });
  return {
    agentName,
    requireKey: (): string => {
      if (!captured) { throw new Error(AGENT_KEY_MISSING); }
      return captured;
    },
  };
}

/** Reconnect from scratch and wipe server state. */
export async function reconnectFreshAndReset(): Promise<TestAPI> {
  const api = await reconnectFresh();
  await resetServerState();
  return api;
}

const SEEDED_MIN_AGENTS = 2;
const SEEDED_MIN_LOCKS = 2;
const SEEDED_MIN_PLANS = 1;
const SEEDED_MIN_MESSAGES = 4;
const AGENTS_DRAINED = 'agents to drain after reset';
const NO_AGENTS = 0;

/** Assert the store holds the full seeded agent/lock/plan/message graph. */
export function assertSeededStore(api: TestAPI): void {
  const agents = api.getAgentCount();
  const locks = api.getLockCount();
  const plans = api.getPlans().length;
  const messages = api.getMessages().length;
  assertOk(agents >= SEEDED_MIN_AGENTS, `At least ${SEEDED_MIN_AGENTS} agents, got ${agents}`);
  assertOk(locks >= SEEDED_MIN_LOCKS, `At least ${SEEDED_MIN_LOCKS} locks, got ${locks}`);
  assertOk(plans >= SEEDED_MIN_PLANS, `At least ${SEEDED_MIN_PLANS} plan, got ${plans}`);
  assertOk(messages >= SEEDED_MIN_MESSAGES, `At least ${SEEDED_MIN_MESSAGES} messages, got ${messages}`);
}

/** Reset server state and wait until the store reports no agents. */
export async function resetAndDrainAgents(): Promise<TestAPI> {
  const api = getTestAPI();
  await resetServerState();
  await api.refreshStatus();
  await waitForCondition(() => api.getAgentCount() === NO_AGENTS, AGENTS_DRAINED);
  return api;
}

/** Build a run-unique name from a prefix plus timestamp/random suffix. */
export function uniqueName(prefix: string): string {
  return `${prefix}-${String(Date.now())}-${String(Math.floor(Math.random() * UNIQUE_NAME_RANDOM_BOUND))}`;
}

/** Duck-typed tree item carrying only an agentName, as used by VSIX commands. */
export function makeAgentItem(agentName: string): unknown {
  return { agentName };
}

const LOCK_TTL_MS = 60000;
const TEST_LOCK_REASON = 'test';

/** File lock fixture with a live expiry window. */
export function makeLiveLock(filePath: string, agentName: string): FileLock {
  return makeFileLock({
    filePath,
    agentName,
    acquiredAt: Date.now(),
    expiresAt: Date.now() + LOCK_TTL_MS,
    reason: TEST_LOCK_REASON,
  });
}

/** Lock tree item backed by a real lock, for command-handler tests. */
export function makeLockTreeItem(filePath: string, agentName: string): LockTreeItem {
  return new LockTreeItem({
    collapsibleState: vscode.TreeItemCollapsibleState.None,
    isCategory: false,
    label: filePath,
    lock: makeLiveLock(filePath, agentName),
  });
}

/** Agent row tree item, as the agents tree renders one agent. */
export function makeAgentTreeItem(agentName: string): AgentTreeItem {
  return new AgentTreeItem({
    agentName,
    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
    itemType: 'agent',
    label: agentName,
  });
}

/** Agent child row that points at a lock file. */
export function makeAgentLockItem(filePath: string, agentName: string): AgentTreeItem {
  return new AgentTreeItem({
    agentName,
    collapsibleState: vscode.TreeItemCollapsibleState.None,
    filePath,
    itemType: 'lock',
    label: filePath,
  });
}

const PLAN_CHILD_PREFIX = 'Goal:';

/**
 * Re-create an agent when the server lost it (e.g. WAL not checkpointed) and
 * return a key that is valid against the current server state.
 * [TEST-RECONNECT-RESTORE] Reused by every suite that rehydrates server state.
 */
export async function ensureAgentRegistered(
  api: TestAPI,
  name: string,
  currentKey: string,
): Promise<string> {
  if (api.findAgentInTree(name)) { return currentKey; }
  return extractKeyFromResult(await callToolString(api, 'register', { name }));
}

/** Re-acquire a lock when the server lost it. */
export async function ensureLockHeld(
  api: TestAPI,
  filePath: string,
  agentName: string,
  agentKey: string,
  reason: string,
): Promise<void> {
  if (api.findLockInTree(filePath)) { return; }
  await acquireLockToolCall(api, filePath, agentName, agentKey, reason);
}

/** Re-send a message when the server lost it. */
export async function ensureMessageSent(
  api: TestAPI,
  fromAgent: string,
  agentKey: string,
  toAgent: string,
  snippet: string,
  content: string,
): Promise<void> {
  if (api.findMessageInTree(snippet)) { return; }
  await sendMessageToolCall(api, fromAgent, agentKey, toAgent, content);
}

/** Re-apply a plan when the server lost it. */
export async function ensurePlanUpdated(
  api: TestAPI,
  agentName: string,
  agentKey: string,
  goal: string,
  currentTask: string,
): Promise<void> {
  const item = api.findAgentInTree(agentName);
  if (item && hasChildWithLabel(item, PLAN_CHILD_PREFIX)) { return; }
  await updatePlanToolCall(api, agentName, agentKey, goal, currentTask);
}

/** Register an agent and wait for it to appear in the agents tree. */
export async function registerAgentAndWait(api: TestAPI, name: string): Promise<string> {
  const key = await registerAgent(api, name);
  await waitForAgentInTree(api, name);
  return key;
}

/** Suite setup for dialog-mocked command suites. */
export async function setupDialogMockedSuite(): Promise<void> {
  await ensureServerReady();
  installDialogMocks();
}

/** Suite teardown for dialog-mocked command suites. */
export async function teardownDialogMockedSuite(): Promise<void> {
  restoreDialogMocks();
  await safeDisconnect();
}

/** Send a message via the MCP tool and return the raw result text. */
export async function sendMessageToolCall(
  api: TestAPI,
  fromAgent: string,
  agentKey: string,
  toAgent: string,
  content: string,
): Promise<string> {
  return callToolString(api, 'message', {
    action: 'send',
    agent_key: agentKey,
    agent_name: fromAgent,
    content,
    to_agent: toAgent,
  });
}

/** Acquire a lock via the MCP tool and return the raw result text. */
export async function acquireLockToolCall(
  api: TestAPI,
  filePath: string,
  agentName: string,
  agentKey: string,
  reason: string,
): Promise<string> {
  return callToolString(api, 'lock', {
    action: 'acquire',
    agent_key: agentKey,
    agent_name: agentName,
    file_path: filePath,
    reason,
  });
}

/** Update an agent plan via the MCP tool and return the raw result text. */
export async function updatePlanToolCall(
  api: TestAPI,
  agentName: string,
  agentKey: string,
  goal: string,
  currentTask: string,
): Promise<string> {
  return callToolString(api, 'plan', {
    action: 'update',
    agent_key: agentKey,
    agent_name: agentName,
    current_task: currentTask,
    goal,
  });
}

// Assertion helpers
export function assertOk(value: unknown, message: string): void {
  if (!value) { throw new Error(`Assertion failed: ${message}`); }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    const suffix = message ? ` - ${message}` : '';
    throw new Error(
      `Assertion failed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${suffix}`,
    );
  }
}
