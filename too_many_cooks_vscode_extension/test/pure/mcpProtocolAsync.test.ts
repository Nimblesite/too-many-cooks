/// Tests for mcpProtocol async functions using a local HTTP server.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { initMcpSession, mcpJsonRpcRequest } from '../../src/services/mcpProtocol';
import { requireRecord, useTestServer } from './testSupport';

const TEST_PORT: number = 19877;
const BASE_URL: string = `http://localhost:${String(TEST_PORT)}`;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const CONTENT_TYPE_JSON = 'application/json';
const JSON_RPC_VERSION = '2.0';
const SESSION_HEADER = 'mcp-session-id';
const SESSION_ID = 'session-abc-123';
const ANONYMOUS_SESSION_ID = 'test';
const NOT_FOUND_BODY = 'Not found';
const NON_RECORD_RESULT = 'not-a-record';
const INVALID_REQUEST_CODE = -32600;
const INVALID_REQUEST_MESSAGE = 'Invalid request';

/** Write a JSON-RPC response body. */
function sendJson(res: http.ServerResponse, payload: unknown): void {
  res.writeHead(HTTP_OK, { 'content-type': CONTENT_TYPE_JSON });
  res.end(JSON.stringify(payload));
}

/** Write a JSON-RPC response body with a session header. */
function sendJsonWithSession(res: http.ServerResponse, payload: unknown): void {
  res.writeHead(HTTP_OK, { 'content-type': CONTENT_TYPE_JSON, [SESSION_HEADER]: SESSION_ID });
  res.end(JSON.stringify(payload));
}

/** JSON-RPC error payloads the mock server returns, keyed by request method. */
const ERROR_RESPONSES: Readonly<Record<string, { readonly code: number; readonly message?: string }>> = {
  'test/error-no-message': { code: INVALID_REQUEST_CODE },
  'test/error-with-message': { code: INVALID_REQUEST_CODE, message: INVALID_REQUEST_MESSAGE },
};

let server: http.Server;

async function startTestServer(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse): void => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer): void => { chunks.push(chunk); });
      req.on('end', (): void => {
        const body: string = Buffer.concat(chunks).toString();
        const url: string = req.url ?? '/';

        if (url === '/mcp') {
          const parsed: Record<string, unknown> = requireRecord(JSON.parse(body), 'jsonrpc request');
          const method: unknown = parsed.method;

          if (method === 'initialize') {
            sendJsonWithSession(res, {
              id: parsed.id,
              jsonrpc: JSON_RPC_VERSION,
              result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'test' } },
            });
            return;
          }

          if (method === 'notifications/initialized') {
            sendJson(res, { jsonrpc: JSON_RPC_VERSION });
            return;
          }

          if (method === 'tools/call') {
            sendJson(res, {
              id: parsed.id,
              jsonrpc: JSON_RPC_VERSION,
              result: { content: [{ type: 'text', text: '{"ok":true}' }] },
            });
            return;
          }

          if (typeof method === 'string' && ERROR_RESPONSES[method]) {
            sendJson(res, { id: parsed.id, jsonrpc: JSON_RPC_VERSION, error: ERROR_RESPONSES[method] });
            return;
          }

          if (method === 'test/non-record-result') {
            sendJson(res, { id: parsed.id, jsonrpc: JSON_RPC_VERSION, result: NON_RECORD_RESULT });
            return;
          }

          sendJson(res, { id: parsed.id, jsonrpc: JSON_RPC_VERSION, result: {} });
          return;
        }

        if (url === '/mcp-no-session') {
          sendJson(res, { id: 1, jsonrpc: JSON_RPC_VERSION, result: {} });
          return;
        }

        res.writeHead(HTTP_NOT_FOUND);
        res.end(NOT_FOUND_BODY);
      });
    });
    server.listen(TEST_PORT, (): void => { resolve(); });
  });
}

async function stopTestServer(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => { resolve(); });
  });
}

/** JSON-RPC error cases and the message each must surface. */
const ERROR_CASES: readonly { readonly message: string; readonly method: string; readonly name: string }[] = [
  { message: INVALID_REQUEST_MESSAGE, method: 'test/error-with-message', name: 'mcpJsonRpcRequest throws on error with message' },
  { message: 'Error', method: 'test/error-no-message', name: 'mcpJsonRpcRequest throws on error without message' },
];

describe('mcpProtocol async', () => {
  useTestServer(startTestServer, stopTestServer);

  it('initMcpSession returns session ID', async () => {
    const sessionId: string = await initMcpSession(BASE_URL, '/mcp', 'test-client');
    assert.strictEqual(sessionId, SESSION_ID);
  });

  it('initMcpSession throws when no session ID', async () => {
    await assert.rejects(
      async (): Promise<void> => { await initMcpSession(BASE_URL, '/mcp-no-session', 'test'); },
      (err: unknown): boolean => {
        return err instanceof Error && err.message.includes('No session ID');
      },
    );
  });

  it('mcpJsonRpcRequest sends request and returns result', async () => {
    const result: Record<string, unknown> = await mcpJsonRpcRequest({
      baseUrl: BASE_URL,
      method: 'tools/call',
      params: { name: 'test', arguments: {} },
      sessionId: SESSION_ID,
    });
    assert.notStrictEqual(result.content, undefined);
  });

  it('mcpJsonRpcRequest returns empty object for non-record result', async () => {
    const result: Record<string, unknown> = await mcpJsonRpcRequest({
      baseUrl: BASE_URL,
      method: 'test/non-record-result',
      params: {},
      sessionId: ANONYMOUS_SESSION_ID,
    });
    assert.deepStrictEqual(result, {});
  });

  for (const errorCase of ERROR_CASES) {
    it(errorCase.name, async () => {
      await assert.rejects(
        async (): Promise<void> => {
          await mcpJsonRpcRequest({
            baseUrl: BASE_URL,
            method: errorCase.method,
            params: {},
            sessionId: ANONYMOUS_SESSION_ID,
          });
        },
        (err: unknown): boolean => {
          return err instanceof Error && err.message === errorCase.message;
        },
      );
    });
  }
});
