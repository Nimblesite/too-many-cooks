// Test helpers for VSCode Extension Host integration tests.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { TestAPI, TreeItemSnapshot } from '../../src/testApi';

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

import { setDialogService, resetDialogService } from '../../src/services/dialogService';

let mocksInstalled = false;

const warningMessageResponses: (string | undefined)[] = [];
const quickPickResponses: (string | undefined)[] = [];
const inputBoxResponses: (string | undefined)[] = [];

export function mockWarningMessage(response: string | undefined): void {
  warningMessageResponses.push(response);
}

export function mockQuickPick(response: string | undefined): void {
  quickPickResponses.push(response);
}

export function mockInputBox(response: string | undefined): void {
  inputBoxResponses.push(response);
}

export function installDialogMocks(): void {
  if (mocksInstalled) { return; }

  setDialogService({
    showErrorMessage: async (_message: string): Promise<string | undefined> => {
      console.log(`[MOCK] showErrorMessage: ${_message}`);
      return undefined;
    },
    showInformationMessage: async (_message: string): Promise<string | undefined> => {
      console.log(`[MOCK] showInformationMessage: ${_message}`);
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
    showWarningMessage: async (): Promise<string | undefined> => {
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

  warningMessageResponses.length = 0;
  quickPickResponses.length = 0;
  inputBoxResponses.length = 0;
  mocksInstalled = false;
  console.log('[TEST HELPER] Dialog mocks restored');
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
