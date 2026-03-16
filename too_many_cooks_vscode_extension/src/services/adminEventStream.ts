// Admin event stream client for real-time server-pushed notifications.
// Automatically reconnects when the SSE connection drops.

import { streamableHttpPost } from './httpClient';

const ADMIN_EVENTS_PATH: string = '/admin/events';
const INITIALIZED_NOTIFICATION: string = 'notifications/initialized';
const MCP_VERSION: string = '2025-03-26';
const CLIENT_NAME: string = 'too-many-cooks-vsix-admin';
const CLIENT_VERSION: string = '1.0.0';
const LOG_PREVIEW_LENGTH: number = 80;
const RECONNECT_DELAY_MS: number = 200;
const SSE_ACCEPT: string = 'application/json, text/event-stream';
const DATA_PREFIX: string = 'data: ';

type LogFn = (msg: string) => void;

export interface AdminEventStreamConfig {
  readonly baseUrl: string;
  readonly log: LogFn;
  readonly onEvent: () => void;
  // Test-only: called each time a new inner read starts, with a function to abort it.
  readonly onInnerAbort?: (abort: () => void) => void;
}

async function initAdminSession(baseUrl: string): Promise<string> {
  const url: string = `${baseUrl}${ADMIN_EVENTS_PATH}`;
  const body: string = JSON.stringify({
    id: 1,
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      capabilities: {},
      clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
      protocolVersion: MCP_VERSION,
    },
  });
  const response: Response = await streamableHttpPost(url, body, null);
  const sessionId: string | null = response.headers.get('mcp-session-id');
  if (sessionId === null || sessionId === '') {
    throw new Error('No admin session ID in response');
  }
  const notifyBody: string = JSON.stringify({
    jsonrpc: '2.0',
    method: INITIALIZED_NOTIFICATION,
    params: {},
  });
  await streamableHttpPost(url, notifyBody, sessionId);
  return sessionId;
}

async function readEventStream(
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  body: ReadableStream<Uint8Array>,
  onEvent: () => void,
  log: LogFn,
): Promise<void> {
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  const decoder: TextDecoder = new TextDecoder();
  let buffer: string = '';
  // eslint-disable-next-line @typescript-eslint/no-inferrable-types
  let eventCount: number = 0;
  for (;;) {
    const result: ReadableStreamReadResult<Uint8Array> = await reader.read();
    if (result.done) {
      log(`[AdminEventStream] Stream done after ${String(eventCount)} events`);
      break;
    }
    buffer += decoder.decode(result.value, { stream: true });
    const lines: string[] = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith(DATA_PREFIX)) {
        const lineData: string = line.substring(DATA_PREFIX.length).trim();
        if (lineData.length > 0) {
          eventCount += 1;
          log(`[AdminEventStream] Event #${String(eventCount)}: ${lineData.substring(0, LOG_PREVIEW_LENGTH)}`);
          onEvent();
        }
      }
    }
  }
}

async function fetchStream(
  sessionId: string,
  baseUrl: string,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array> | null> {
  const headers: Headers = new Headers();
  headers.set('accept', SSE_ACCEPT);
  headers.set('mcp-session-id', sessionId);
  const response: Response = await fetch(`${baseUrl}${ADMIN_EVENTS_PATH}`, {
    headers,
    method: 'GET',
    signal,
  });
  if (!response.ok || response.body === null) { return null; }
  return response.body;
}

async function delayMs(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    if (signal.aborted) { resolve(); return; }
    const timer: ReturnType<typeof setTimeout> = setTimeout(resolve, ms);
    signal.addEventListener('abort', (): void => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

async function connectAndRead(
  sessionId: string,
  outerSignal: AbortSignal,
  config: Readonly<AdminEventStreamConfig>,
): Promise<void> {
  const innerController: AbortController = new AbortController();
  config.onInnerAbort?.(() => { innerController.abort(); });
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  function forwardAbort(): void { innerController.abort(); }
  outerSignal.addEventListener('abort', forwardAbort, { once: true });
  try {
    const body: ReadableStream<Uint8Array> | null =
      await fetchStream(sessionId, config.baseUrl, innerController.signal);
    if (body === null) {
      config.log('[AdminEventStream] Stream connect failed');
      return;
    }
    await readEventStream(body, config.onEvent, config.log);
    config.log('[AdminEventStream] Event stream ended — will reconnect');
  } catch (err: unknown) {
    if (!innerController.signal.aborted) {
      config.log(`[AdminEventStream] Stream error: ${String(err)}`);
    }
  } finally {
    outerSignal.removeEventListener('abort', forwardAbort);
  }
}

async function reconnectLoop(
  sessionId: string,
  outerSignal: AbortSignal,
  config: Readonly<AdminEventStreamConfig>,
): Promise<void> {
  while (!outerSignal.aborted) {
    await connectAndRead(sessionId, outerSignal, config);
    config.log(`[AdminEventStream] Reconnecting in ${String(RECONNECT_DELAY_MS)}ms`);
    await delayMs(RECONNECT_DELAY_MS, outerSignal);
    // Sync state after reconnect to catch events missed while the stream was down.
    // If disconnected, handleAdminEvent will swallow the resulting error.
    config.onEvent();
  }
  config.log('[AdminEventStream] Reconnect loop stopped (disconnected)');
}

export async function startAdminEventStream(
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  abortController: AbortController,
  config: Readonly<AdminEventStreamConfig>,
): Promise<void> {
  const { signal }: { readonly signal: AbortSignal } = abortController;
  const sessionId: string = await initAdminSession(config.baseUrl);
  config.log(`[AdminEventStream] Session started: ${sessionId}`);
  // eslint-disable-next-line no-void
  void reconnectLoop(sessionId, signal, config);
}
