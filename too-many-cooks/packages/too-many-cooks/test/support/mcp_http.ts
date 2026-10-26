/// Shared MCP Streamable-HTTP client for E2E tests ([DEDUP-DESLOP]).
///
/// Replaces the per-file McpClient classes that each re-implemented
/// initialize / tools/call / session-header plumbing.

import {
  getArrayField,
  getRecordField,
  getStringField,
  isRecord,
  parseJsonRecord,
} from "./json.js";

export const JSONRPC_VERSION = "2.0";
export const MCP_PROTOCOL_VERSION = "2025-03-26";
/** Older protocol version used by tests that must not advertise 2025-03-26. */
export const LEGACY_PROTOCOL_VERSION = "2024-11-05";
export const ACCEPT_STREAMABLE = "application/json, text/event-stream";
export const CONTENT_TYPE_JSON = "application/json";
export const MCP_PATH = "/mcp";
export const ADMIN_EVENTS_PATH = "/admin/events";
export const SESSION_ID_HEADER = "mcp-session-id";
const DATA_PREFIX = "data: ";

export type ClientInfo = {
  readonly name: string;
  readonly version: string;
};

export type McpClientOptions = {
  readonly baseUrl: string;
  readonly path?: string;
  readonly protocolVersion?: string;
  readonly clientInfo: ClientInfo;
};

/** Parses a Streamable-HTTP body: bare JSON or an SSE `data:` line. */
export const parseMcpPayload = (
  text: string,
): Record<string, unknown> => {
  if (text.trimStart().startsWith("{")) {
    return parseJsonRecord(text);
  }
  for (const line of text.split("\n")) {
    if (line.startsWith(DATA_PREFIX)) {
      try {
        return parseJsonRecord(line.substring(DATA_PREFIX.length));
      } catch {
        continue;
      }
    }
  }
  throw new Error(`Could not parse: ${text}`);
};

/** Initializes a session on /admin/events and returns its session ID. */
export const initAdminEventsSession = async (
  baseUrl: string,
  clientInfo: ClientInfo,
): Promise<string> => {
  const client = new McpHttpClient({
    baseUrl,
    path: ADMIN_EVENTS_PATH,
    clientInfo,
  });
  await client.initSession();
  return client.getSessionId();
};

export class McpHttpClient {
  private readonly baseUrl: string;
  private readonly path: string;
  private readonly protocolVersion: string;
  private readonly clientInfo: ClientInfo;
  private sessionId = "";
  private nextId = 1;

  public constructor(opts: McpClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.path = opts.path ?? MCP_PATH;
    this.protocolVersion = opts.protocolVersion ?? MCP_PROTOCOL_VERSION;
    this.clientInfo = opts.clientInfo;
  }

  /** Session ID assigned by the server; throws before init. */
  public getSessionId(): string {
    if (this.sessionId.length === 0) {
      throw new Error("Session not initialized");
    }
    return this.sessionId;
  }

  /** Runs `initialize` and returns its result; optionally sends `notifications/initialized`. */
  public async initSession(
    sendInitialized: boolean = true,
  ): Promise<Record<string, unknown>> {
    const initResult = await this.request("initialize", {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: this.clientInfo.name, version: this.clientInfo.version },
    });
    if (this.sessionId.length === 0) {
      throw new Error(
        `No session ID after init: ${JSON.stringify(initResult)}`,
      );
    }
    if (sendInitialized) {
      await this.post(this.notificationBody());
    }
    return initResult;
  }

  /** Calls a tool and returns the first text content block. */
  public async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const result = await this.callToolRaw(name, args);
    const block = getArrayField(result, "content")[0];
    if (!isRecord(block)) {
      throw new Error("tool result has no content");
    }
    return getStringField(block, "text");
  }

  /** Calls a tool and returns the raw result record. */
  public async callToolRaw(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.request("tools/call", { name, arguments: args });
  }

  private notificationBody(): string {
    return JSON.stringify({
      jsonrpc: JSONRPC_VERSION,
      method: "notifications/initialized",
      params: {},
    });
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const body = JSON.stringify({
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      params,
    });
    const response = await this.post(body);
    const json = parseMcpPayload(await response.text());
    return this.unwrapResult(json);
  }

  private unwrapResult(
    json: Record<string, unknown>,
  ): Record<string, unknown> {
    if ("error" in json && json.error !== undefined) {
      const err = isRecord(json.error) ? json.error : {};
      const message = typeof err.message === "string" ? err.message : "Error";
      return { isError: true, content: [{ type: "text", text: message }] };
    }
    return getRecordField(json, "result");
  }

  /** POSTs a JSON-RPC body, capturing the session ID header. */
  public async post(body: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": CONTENT_TYPE_JSON,
      Accept: ACCEPT_STREAMABLE,
    };
    if (this.sessionId.length > 0) {
      headers[SESSION_ID_HEADER] = this.sessionId;
    }
    const response = await fetch(`${this.baseUrl}${this.path}`, {
      method: "POST",
      headers,
      body,
    });
    const sid = response.headers.get(SESSION_ID_HEADER);
    if (sid !== null) {
      this.sessionId = sid;
    }
    return response;
  }
}
