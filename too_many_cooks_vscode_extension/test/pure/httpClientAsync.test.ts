/// Tests for httpClient async functions using a local HTTP server.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import 'module-alias/register';
import { streamableHttpPost, postJsonRequest, checkServerAvailable } from 'services/httpClient';

const TEST_PORT: number = 19876;
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

        if (url === '/echo') {
          res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'test-session-123' });
          res.end(body);
          return;
        }

        if (url === '/admin/status') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"agents":[],"locks":[],"messages":[],"plans":[]}');
          return;
        }

        if (url === '/sse-response') {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end('event: message\ndata: {"id":1,"result":{"content":[{"type":"text","text":"hello"}]}}\n\n');
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

describe('httpClient async functions', () => {
  before(async (): Promise<void> => {
    await startTestServer();
  });

  after(async (): Promise<void> => {
    await stopTestServer();
  });

  it('streamableHttpPost sends POST and returns response', async () => {
    const response: Response = await streamableHttpPost(
      `${BASE_URL}/echo`,
      JSON.stringify({ test: true }),
      null,
    );
    assert.strictEqual(response.ok, true);
    const text: string = await response.text();
    const parsed: Record<string, unknown> = JSON.parse(text) as Record<string, unknown>;
    assert.strictEqual(parsed.test, true);
  });

  it('streamableHttpPost includes session header when provided', async () => {
    const response: Response = await streamableHttpPost(
      `${BASE_URL}/echo`,
      JSON.stringify({ data: 'value' }),
      'my-session-id',
    );
    assert.strictEqual(response.ok, true);
  });

  it('postJsonRequest sends JSON and returns text', async () => {
    const text: string = await postJsonRequest(`${BASE_URL}/echo`, { key: 'val' });
    const parsed: Record<string, unknown> = JSON.parse(text) as Record<string, unknown>;
    assert.strictEqual(parsed.key, 'val');
  });

  it('checkServerAvailable returns true for running server', async () => {
    const available: boolean = await checkServerAvailable(BASE_URL);
    assert.strictEqual(available, true);
  });

  it('checkServerAvailable returns false for unreachable server', async () => {
    const available: boolean = await checkServerAvailable('http://localhost:19999');
    assert.strictEqual(available, false);
  });
});
