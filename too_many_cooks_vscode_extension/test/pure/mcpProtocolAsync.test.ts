/// Tests for mcpProtocol async functions using a local HTTP server.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import 'module-alias/register';
import { initMcpSession, mcpJsonRpcRequest } from 'services/mcpProtocol';

const TEST_PORT: number = 19877;
const BASE_URL: string = `http://localhost:${String(TEST_PORT)}`;

let server: http.Server;

function startTestServer(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse): void => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer): void => { chunks.push(chunk); });
      req.on('end', (): void => {
        const body: string = Buffer.concat(chunks).toString();
        const url: string = req.url ?? '/';

        if (url === '/mcp') {
          const parsed: Record<string, unknown> = JSON.parse(body) as Record<string, unknown>;
          const method: unknown = parsed.method;

          if (method === 'initialize') {
            res.writeHead(200, {
              'content-type': 'application/json',
              'mcp-session-id': 'session-abc-123',
            });
            res.end(JSON.stringify({
              id: parsed.id,
              jsonrpc: '2.0',
              result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'test' } },
            }));
            return;
          }

          if (method === 'notifications/initialized') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0' }));
            return;
          }

          if (method === 'tools/call') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              id: parsed.id,
              jsonrpc: '2.0',
              result: { content: [{ type: 'text', text: '{"ok":true}' }] },
            }));
            return;
          }

          if (method === 'test/error-with-message') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              id: parsed.id,
              jsonrpc: '2.0',
              error: { code: -32600, message: 'Invalid request' },
            }));
            return;
          }

          if (method === 'test/error-no-message') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              id: parsed.id,
              jsonrpc: '2.0',
              error: { code: -32600 },
            }));
            return;
          }

          if (method === 'test/non-record-result') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              id: parsed.id,
              jsonrpc: '2.0',
              result: 'not-a-record',
            }));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: parsed.id, jsonrpc: '2.0', result: {} }));
          return;
        }

        if (url === '/mcp-no-session') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 1, jsonrpc: '2.0', result: {} }));
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });
    });
    server.listen(TEST_PORT, (): void => { resolve(); });
  });
}

function stopTestServer(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    server.close((): void => { resolve(); });
  });
}

describe('mcpProtocol async', () => {
  before(async (): Promise<void> => {
    await startTestServer();
  });

  after(async (): Promise<void> => {
    await stopTestServer();
  });

  it('initMcpSession returns session ID', async () => {
    const sessionId: string = await initMcpSession(BASE_URL, '/mcp', 'test-client');
    assert.strictEqual(sessionId, 'session-abc-123');
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
      sessionId: 'session-abc-123',
    });
    assert.notStrictEqual(result.content, undefined);
  });

  it('mcpJsonRpcRequest returns empty object for non-record result', async () => {
    const result: Record<string, unknown> = await mcpJsonRpcRequest({
      baseUrl: BASE_URL,
      method: 'test/non-record-result',
      params: {},
      sessionId: 'test',
    });
    assert.deepStrictEqual(result, {});
  });

  it('mcpJsonRpcRequest throws on error with message', async () => {
    await assert.rejects(
      async (): Promise<void> => {
        await mcpJsonRpcRequest({
          baseUrl: BASE_URL,
          method: 'test/error-with-message',
          params: {},
          sessionId: 'test',
        });
      },
      (err: unknown): boolean => {
        return err instanceof Error && err.message === 'Invalid request';
      },
    );
  });

  it('mcpJsonRpcRequest throws on error without message', async () => {
    await assert.rejects(
      async (): Promise<void> => {
        await mcpJsonRpcRequest({
          baseUrl: BASE_URL,
          method: 'test/error-no-message',
          params: {},
          sessionId: 'test',
        });
      },
      (err: unknown): boolean => {
        return err instanceof Error && err.message === 'Error';
      },
    );
  });
});
