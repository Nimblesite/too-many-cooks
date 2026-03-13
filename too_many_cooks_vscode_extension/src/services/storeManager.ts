// Store manager - orchestrates MCP server connection and state.
// The extension NEVER spawns or bundles a server binary.
// It connects to an already-running external server only.

import { checkServerAvailable, isRecord, postJsonRequest } from './httpClient';
import { extractToolResultText, initMcpSession, mcpJsonRpcRequest } from './mcpProtocol';
import type { AppState } from '../state/types';
import { Store } from '../state/store';
import { parseStatusResponse } from './statusParser';
import { startAdminEventStream } from './adminEventStream';

const DEFAULT_PORT: number = 4040;
const SERVER_NOT_RUNNING_MSG: string =
  'MCP server is not running. Start it externally before connecting.';

type LogFn = (msg: string) => void;

export class StoreManager {
  private readonly store: Store;
  public readonly workspaceFolder: string;
  private readonly baseUrl: string;
  private connected: boolean = false;
  private connectPromise: Promise<void> | null = null;
  private mcpSessionId: string | null = null;
  private eventAbortController: AbortController | null = null;
  private readonly log: LogFn;

  public constructor(workspaceFolder: string, log: LogFn, port: number = DEFAULT_PORT) {
    this.workspaceFolder = workspaceFolder;
    this.baseUrl = `http://localhost:${String(port)}`;
    this.store = new Store();
    this.log = log;
  }

  public get state(): AppState {
    return this.store.getState();
  }

  public subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  public get isConnecting(): boolean {
    return this.connectPromise !== null;
  }

  public async connect(): Promise<void> {
    this.log('[StoreManager] connect() called');
    if (this.connectPromise !== null) {
      await this.connectPromise;
      return;
    }
    if (this.connected) { return; }
    this.store.dispatch({ status: 'connecting', type: 'SetConnectionStatus' });
    this.connectPromise = this.doConnect();
    try {
      await this.connectPromise;
    } catch (err: unknown) {
      this.store.dispatch({ status: 'disconnected', type: 'SetConnectionStatus' });
      throw err;
    } finally {
      this.connectPromise = null;
    }
  }

  private async doConnect(): Promise<void> {
    const externalRunning: boolean = await checkServerAvailable(this.baseUrl);
    if (!externalRunning) {
      throw new Error(SERVER_NOT_RUNNING_MSG);
    }
    this.connected = true;
    await this.refreshStatus();
    await this.connectEventStream();
    this.store.dispatch({ status: 'connected', type: 'SetConnectionStatus' });
  }

  private async connectEventStream(): Promise<void> {
    this.eventAbortController?.abort();
    this.eventAbortController = new AbortController();
    await startAdminEventStream(this.eventAbortController, {
      baseUrl: this.baseUrl,
      log: this.log,
      onEvent: (): void => { this.handleAdminEvent(); },
    });
  }

  private handleAdminEvent(): void {
    this.log('[StoreManager] Admin event received → refreshing');
    this.refreshStatus().catch((err: unknown): void => {
      this.log(`[StoreManager] Refresh failed: ${String(err)}`);
    });
  }

  // Test-only: Corrupt the cached MCP session ID to
  // Simulate a server restart. The next callTool will
  // Detect the stale session and transparently reconnect.
  public invalidateMcpSession(): void {
    this.mcpSessionId = 'stale-session-00000000';
  }

  public disconnect(): void {
    this.connectPromise = null;
    this.mcpSessionId = null;
    this.eventAbortController?.abort();
    this.eventAbortController = null;
    this.connected = false;
    this.store.dispatch({ type: 'ResetState' });
    this.store.dispatch({ status: 'disconnected', type: 'SetConnectionStatus' });
  }

  public async refreshStatus(): Promise<void> {
    if (!this.isConnected) { throw new Error('Not connected'); }
    const response: Response = await fetch(`${this.baseUrl}/admin/status`);
    if (!response.ok) {
      this.log(`[StoreManager] refreshStatus: response not ok (${String(response.status)})`);
      return;
    }
    const json: unknown = await response.json();
    if (!isRecord(json)) {
      this.log('[StoreManager] refreshStatus: response is not a record');
      return;
    }
    const statusData: ReturnType<typeof parseStatusResponse> = parseStatusResponse(json);
    this.log(
      `[StoreManager] refreshStatus: ${String(statusData.agents.length)} agents, ` +
      `${String(statusData.locks.length)} locks, ` +
      `${String(statusData.messages.length)} msgs, ` +
      `${String(statusData.plans.length)} plans`,
    );
    this.store.dispatch({ agents: statusData.agents, type: 'SetAgents' });
    this.store.dispatch({ locks: statusData.locks, type: 'SetLocks' });
    this.store.dispatch({ messages: statusData.messages, type: 'SetMessages' });
    this.store.dispatch({ plans: statusData.plans, type: 'SetPlans' });
  }

  public async forceReleaseLock(filePath: string): Promise<void> {
    await postJsonRequest(`${this.baseUrl}/admin/delete-lock`, { filePath });
    await this.refreshStatus();
  }

  public async deleteAgent(agentName: string): Promise<void> {
    await postJsonRequest(`${this.baseUrl}/admin/delete-agent`, { agentName });
    await this.refreshStatus();
  }

  public async sendMessage(fromAgent: string, toAgent: string, content: string): Promise<void> {
    await postJsonRequest(`${this.baseUrl}/admin/send-message`, { content, fromAgent, toAgent });
    await this.refreshStatus();
  }

  public async callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<string> {
    if (!this.isConnected) { return '{"error":"Not connected"}'; }
    try {
      return await this.doCallTool(name, args);
    } catch {
      // Session may be stale (server restarted). Clear
      // It and retry once with a fresh session.
      this.log('[StoreManager] callTool failed — retrying with fresh session');
      this.mcpSessionId = null;
      try {
        return await this.doCallTool(name, args);
      } catch (retryErr: unknown) {
        this.mcpSessionId = null;
        return `{"error":"${String(retryErr)}"}`;
      }
    }
  }

  private async doCallTool(name: string, args: Readonly<Record<string, unknown>>): Promise<string> {
    if (this.mcpSessionId === null) {
      this.mcpSessionId = await initMcpSession(this.baseUrl, '/mcp', 'too-many-cooks-vsix');
    }
    const result: Record<string, unknown> = await mcpJsonRpcRequest({
      baseUrl: this.baseUrl,
      method: 'tools/call',
      params: { arguments: args, name },
      sessionId: this.mcpSessionId,
    });
    const text: string = extractToolResultText(result);
    await this.refreshStatus();
    return text;
  }
}
