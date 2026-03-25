// Store manager - orchestrates MCP server connection and state.
//
// Phase 3 of the VSIX connection switcher.
// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md
//
// Accepts a ConnectionTarget (local or cloud) to determine base URL and auth headers.
// In cloud mode, all HTTP requests include Authorization, X-Tenant-Id, X-Workspace-Id headers.

import type { AgentIdentity, AgentPlan, AppState, FileLock, Message } from '../state/types';
import type { ConnectionMode, ConnectionTarget } from './connectionTypes';
import { LOCAL_BASE_URL_PREFIX, buildAuthHeaders, buildBaseUrl, fetchWithAuth, postJsonWithAuth } from './storeManagerHelpers';
import { checkServerAvailable, isRecord } from './httpClient';
import { extractToolResultText, initMcpSession, mcpJsonRpcRequest } from './mcpProtocol';
import type { StatusData } from './statusParser';
import { Store } from '../state/store';
import { parseStatusResponse } from './statusParser';
import { startAdminEventStream } from './adminEventStream';

/** Decryptor interface -- subset of CloudDecryptor for dependency injection. */
export interface StatusDecryptor {
  readonly decryptLocks: (locks: readonly FileLock[]) => { readonly ok: boolean; readonly value?: readonly FileLock[] };
  readonly decryptMessages: (msgs: readonly Message[]) => { readonly ok: boolean; readonly value?: readonly Message[] };
  readonly decryptPlans: (plans: readonly AgentPlan[]) => { readonly ok: boolean; readonly value?: readonly AgentPlan[] };
}

const DEFAULT_PORT: number = 4040;
const SERVER_NOT_RUNNING_MSG: string =
  'MCP server is not running. Start it externally before connecting.';
const STALE_SESSION_ID: string = 'stale-session-00000000';
const NOT_CONNECTED_JSON: string = '{"error":"Not connected"}';

type LogFn = (msg: string) => void;

export class StoreManager {
  private readonly store: Store;
  public readonly workspaceFolder: string;
  private baseUrl: string;
  private authHeaders: Readonly<Record<string, string>> = {};
  private connectionTarget: ConnectionTarget | null = null;
  private decryptor: StatusDecryptor | null = null;
  private connected: boolean = false;
  private connectPromise: Promise<void> | null = null;
  private mcpSessionId: string | null = null;
  private eventAbortController: AbortController | null = null;
  private innerAbort: (() => void) | null = null;
  private refreshSeq: number = 0;
  private readonly log: LogFn;

  public constructor(workspaceFolder: string, log: LogFn, port: number = DEFAULT_PORT) {
    this.workspaceFolder = workspaceFolder;
    this.baseUrl = `${LOCAL_BASE_URL_PREFIX}${String(port)}`;
    this.store = new Store();
    this.log = log;
  }

  /** Reconfigure the store manager for a new connection target. */
  public setTarget(target: ConnectionTarget): void {
    this.connectionTarget = target;
    this.baseUrl = buildBaseUrl(target);
    this.authHeaders = buildAuthHeaders(target);
    this.log(`[StoreManager] Target set: ${target.mode} → ${this.baseUrl}`);
  }

  /** Set a decryptor for cloud mode status decryption. */
  public setDecryptor(dec: StatusDecryptor | null): void {
    this.decryptor = dec;
  }

  /** Get the current connection mode. */
  public getConnectionMode(): ConnectionMode {
    if (!this.connected) { return 'disconnected'; }
    return this.connectionTarget?.mode ?? 'disconnected';
  }

  /** Get the current connection target. */
  public getTarget(): ConnectionTarget | null {
    return this.connectionTarget;
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

  private async tryReconnect(): Promise<void> {
    this.log('[StoreManager] Attempting auto-reconnect');
    try { await this.connect(); } catch {
      throw new Error('Not connected');
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
      onInnerAbort: (abort: () => void): void => { this.innerAbort = abort; },
    });
  }

  private handleAdminEvent(): void {
    if (this.eventAbortController === null) { return; }
    this.log('[StoreManager] Admin event received → refreshing');
    this.refreshStatus().catch((err: unknown): void => {
      this.log(`[StoreManager] Refresh failed: ${String(err)}`);
    });
  }

  /** Decrypt status data if a decryptor is set (cloud mode). */
  private decryptStatus(data: StatusData): StatusData {
    if (this.decryptor === null) { return data; }
    const msgs: ReturnType<StatusDecryptor['decryptMessages']> = this.decryptor.decryptMessages(data.messages);
    const plans: ReturnType<StatusDecryptor['decryptPlans']> = this.decryptor.decryptPlans(data.plans);
    const locks: ReturnType<StatusDecryptor['decryptLocks']> = this.decryptor.decryptLocks(data.locks);
    return {
      agents: data.agents,
      locks: locks.ok && locks.value ? locks.value : data.locks,
      messages: msgs.ok && msgs.value ? msgs.value : data.messages,
      plans: plans.ok && plans.value ? plans.value : data.plans,
    };
  }

  // Test-only: Corrupt the cached MCP session ID to
  // Simulate a server restart. The next callTool will
  // Detect the stale session and transparently reconnect.
  public invalidateMcpSession(): void {
    this.mcpSessionId = STALE_SESSION_ID;
  }

  // Test-only: Kill the current SSE read WITHOUT disconnecting or stopping the reconnect loop.
  // Simulates the server closing the SSE connection (server restart, idle timeout, network drop).
  // After this call, the reconnect loop re-establishes the stream and catches missed events.
  public invalidateEventStream(): void {
    this.innerAbort?.();
    this.innerAbort = null;
  }

  public disconnect(): void {
    this.connectPromise = null;
    this.mcpSessionId = null;
    this.innerAbort = null;
    this.eventAbortController?.abort();
    this.eventAbortController = null;
    this.connected = false;
    this.connectionTarget = null;
    this.authHeaders = {};
    this.decryptor = null;
    this.store.dispatch({ type: 'ResetState' });
    this.store.dispatch({ status: 'disconnected', type: 'SetConnectionStatus' });
  }

  public async refreshStatus(): Promise<void> {
    if (!this.isConnected) { await this.tryReconnect(); }
    this.refreshSeq += 1;
    const seq: number = this.refreshSeq;
    const response: Response = await fetchWithAuth(
      `${this.baseUrl}/admin/status`,
      this.authHeaders,
    );
    if (seq !== this.refreshSeq) { return; }
    if (!response.ok) {
      this.log(`[StoreManager] refreshStatus: response not ok (${String(response.status)})`);
      return;
    }
    const json: unknown = await response.json();
    if (seq !== this.refreshSeq) { return; }
    if (!isRecord(json)) {
      this.log('[StoreManager] refreshStatus: response is not a record');
      return;
    }
    const statusData: StatusData = parseStatusResponse(json);
    const decrypted: StatusData = this.decryptStatus(statusData);
    this.log(
      `[StoreManager] refreshStatus: ${String(decrypted.agents.length)} agents, ` +
      `${String(decrypted.locks.length)} locks, ` +
      `${String(decrypted.messages.length)} msgs, ` +
      `${String(decrypted.plans.length)} plans`,
    );
    this.store.dispatch({ agents: decrypted.agents, type: 'SetAgents' });
    this.store.dispatch({ locks: decrypted.locks, type: 'SetLocks' });
    this.store.dispatch({ messages: decrypted.messages, type: 'SetMessages' });
    this.store.dispatch({ plans: decrypted.plans, type: 'SetPlans' });
  }

  public async forceReleaseLock(filePath: string): Promise<void> {
    await postJsonWithAuth(
      `${this.baseUrl}/admin/delete-lock`,
      { filePath },
      this.authHeaders,
    );
    await this.refreshStatus();
  }

  public async deleteAgent(agentName: string): Promise<void> {
    await postJsonWithAuth(
      `${this.baseUrl}/admin/delete-agent`,
      { agentName },
      this.authHeaders,
    );
    await this.refreshStatus();
  }

  public async deleteAllAgents(): Promise<void> {
    const { agents }: { readonly agents: readonly AgentIdentity[] } = this.store.getState();
    for (const agent of agents) {
      await postJsonWithAuth(
        `${this.baseUrl}/admin/delete-agent`,
        { agentName: agent.agentName },
        this.authHeaders,
      );
    }
    await this.refreshStatus();
  }

  public async sendMessage(fromAgent: string, toAgent: string, content: string): Promise<void> {
    await postJsonWithAuth(
      `${this.baseUrl}/admin/send-message`,
      { content, fromAgent, toAgent },
      this.authHeaders,
    );
    await this.refreshStatus();
  }

  public async callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<string> {
    if (!this.isConnected) {
      try { await this.tryReconnect(); } catch { return NOT_CONNECTED_JSON; }
    }
    try {
      return await this.doCallTool(name, args);
    } catch {
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
