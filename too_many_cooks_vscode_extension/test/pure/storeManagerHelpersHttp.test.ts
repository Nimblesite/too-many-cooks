/// Tests for storeManagerHelpers URL/auth/HTTP helpers and httpClient parse failures.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import {
  buildAuthHeaders,
  buildBaseUrl,
  fetchWithAuth,
  postJsonWithAuth,
} from '../../src/services/storeManagerHelpers';
import {
  checkServerAvailable,
  parseStreamableHttpResponse,
} from '../../src/services/httpClient';
import type { CloudTarget } from '../../src/services/connectionTypes';

const CLOUD_API_URL = 'https://example.invalid/functions/v1/tmc-api';
const CLOUD_API_KEY = 'test-api-key';
const CLOUD_TENANT_ID = 'tenant-1';
const CLOUD_WORKSPACE_ID = 'workspace-1';
const CLOUD_PASSPHRASE = 'passphrase';
const BEARER_PREFIX = 'Bearer ';
const UNREACHABLE_PORT = 1;
const LOCAL_SERVER_PORT = 19878;
const LOCAL_BASE_URL = `http://localhost:${String(LOCAL_SERVER_PORT)}`;
const STATUS_PATH = '/admin/status';
const DELETE_LOCK_PATH = '/admin/delete-lock';
const DELETE_LOCK_BODY = 'deleted';
const INVALID_STREAM_LINE = 'data: {not valid json';
const COULD_NOT_PARSE_FRAGMENT = 'Could not parse';

function makeCloudTarget(): CloudTarget {
  return {
    apiKey: CLOUD_API_KEY,
    apiUrl: CLOUD_API_URL,
    mode: 'cloud',
    passphrase: CLOUD_PASSPHRASE,
    tenantId: CLOUD_TENANT_ID,
    transport: 'http-streamable',
    workspaceId: CLOUD_WORKSPACE_ID,
  };
}

let server: http.Server | null = null;

async function startServer(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse): void => {
      const url: string = req.url ?? '/';
      if (url === STATUS_PATH && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (url === DELETE_LOCK_PATH && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(DELETE_LOCK_BODY);
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    server.listen(LOCAL_SERVER_PORT, (): void => { resolve(); });
  });
}

async function stopServer(): Promise<void> {
  if (server === null) { return; }
  await new Promise<void>((resolve: () => void): void => {
    server?.close((): void => { resolve(); });
  });
  server = null;
}

describe('storeManagerHelpers URL and auth helpers', () => {
  it('buildBaseUrl and buildAuthHeaders cover the cloud branches', () => {
    const target: CloudTarget = makeCloudTarget();
    assert.strictEqual(buildBaseUrl(target), CLOUD_API_URL);
    const headers = buildAuthHeaders(target);
    assert.strictEqual(headers.Authorization, `${BEARER_PREFIX}${CLOUD_API_KEY}`);
    assert.strictEqual(headers['X-Tenant-Id'], CLOUD_TENANT_ID);
    assert.strictEqual(headers['X-Workspace-Id'], CLOUD_WORKSPACE_ID);
  });

  it('buildAuthHeaders returns no headers for a local target', () => {
    const headers = buildAuthHeaders({ mode: 'local', port: 4040, transport: 'http-streamable' });
    assert.deepStrictEqual(headers, {});
  });
});

describe('storeManagerHelpers HTTP transport helpers', () => {
  before(async (): Promise<void> => { await startServer(); });
  after(async (): Promise<void> => { await stopServer(); });

  it('fetchWithAuth injects non-empty headers and reaches the server', async () => {
    const target: CloudTarget = makeCloudTarget();
    const response: Response = await fetchWithAuth(
      `${LOCAL_BASE_URL}${STATUS_PATH}`,
      buildAuthHeaders(target),
    );
    assert.strictEqual(response.ok, true);
  });

  it('postJsonWithAuth injects extra headers into the request', async () => {
    const target: CloudTarget = makeCloudTarget();
    const text: string = await postJsonWithAuth(
      `${LOCAL_BASE_URL}${DELETE_LOCK_PATH}`,
      { filePath: '/nonexistent-helper-test-lock' },
      buildAuthHeaders(target),
    );
    assert.strictEqual(typeof text, 'string');
    assert.strictEqual(text, DELETE_LOCK_BODY);
  });

  it('checkServerAvailable returns false when the server is unreachable', async () => {
    assert.strictEqual(
      await checkServerAvailable(`http://localhost:${UNREACHABLE_PORT}`),
      false,
    );
  });
});

describe('parseStreamableHttpResponse failure path', () => {
  it('skips unparseable lines then throws', () => {
    assert.throws(
      (): void => { parseStreamableHttpResponse(INVALID_STREAM_LINE); },
      (err: unknown): boolean => {
        return err instanceof Error && err.message.includes(COULD_NOT_PARSE_FRAGMENT);
      },
    );
  });
});
