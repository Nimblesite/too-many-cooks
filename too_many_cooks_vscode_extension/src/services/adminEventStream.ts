// Admin event stream client for real-time server-pushed notifications.

import { streamableHttpPost } from './httpClient';

const ADMIN_EVENTS_PATH: string = '/admin/events';
const INITIALIZED_NOTIFICATION: string = 'notifications/initialized';
const MCP_VERSION: string = '2025-03-26';
const CLIENT_NAME: string = 'too-many-cooks-vsix-admin';
const CLIENT_VERSION: string = '1.0.0';
const LOG_PREVIEW_LENGTH: number = 80;

type LogFn = (msg: string) => void;

export interface AdminEventStreamConfig {
  readonly baseUrl: string;
  readonly log: LogFn;
  readonly onEvent: () => void;
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
  const dataPrefix: string = 'data: ';
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
      if (line.startsWith(dataPrefix)) {
        const lineData: string = line.substring(dataPrefix.length).trim();
        if (lineData.length > 0) {
          eventCount += 1;
          log(`[AdminEventStream] Event #${String(eventCount)}: ${lineData.substring(0, LOG_PREVIEW_LENGTH)}`);
          onEvent();
        }
      }
    }
  }
}

async function listenAdminEvents(
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  signal: AbortSignal,
  config: Readonly<AdminEventStreamConfig>,
): Promise<void> {
  const headers: Headers = new Headers();
  headers.set('accept', 'application/json, text/event-stream');
  headers.set('mcp-session-id', sessionId);
  try {
    const response: Response = await fetch(`${config.baseUrl}${ADMIN_EVENTS_PATH}`, {
      headers,
      method: 'GET',
      signal,
    });
    const { body }: { readonly body: ReadableStream<Uint8Array> | null } = response;
    if (!response.ok || body === null) {
      config.log(`[AdminEventStream] GET failed: ${String(response.status)}`);
      return;
    }
    // Read events in background — don't await (runs indefinitely)
    // eslint-disable-next-line no-void
    void (async (): Promise<void> => {
      try {
        await readEventStream(body, config.onEvent, config.log);
        config.log('[AdminEventStream] Event stream ended');
      } catch (err: unknown) {
        if (!signal.aborted) {
          config.log(`[AdminEventStream] Stream read error: ${String(err)}`);
        }
      }
    })();
  } catch (err: unknown) {
    if (!signal.aborted) {
      config.log(`[AdminEventStream] Stream error: ${String(err)}`);
    }
  }
}

export async function startAdminEventStream(
  // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
  abortController: AbortController,
  config: Readonly<AdminEventStreamConfig>,
): Promise<void> {
  const { signal }: { readonly signal: AbortSignal } = abortController;
  const sessionId: string = await initAdminSession(config.baseUrl);
  config.log(`[AdminEventStream] Session started: ${sessionId}`);
  await listenAdminEvents(sessionId, signal, config);
}
