// HTTP helpers for StoreManager — extracted to keep storeManager.ts under 300 LOC.

import type { ConnectionTarget } from './connectionTypes';

/** Local base URL prefix. */
const LOCAL_BASE_URL_PREFIX: string = 'http://localhost:';

/** Authorization header key. */
const AUTHORIZATION_HEADER: string = 'Authorization';

/** Authorization bearer prefix. */
const AUTH_BEARER_PREFIX: string = 'Bearer ';

/** Content-Type header key. */
const CONTENT_TYPE_HEADER: string = 'Content-Type';

/** Content-Type JSON value. */
const CONTENT_TYPE_JSON: string = 'application/json';

/** Workspace ID header key. */
const WORKSPACE_ID_HEADER: string = 'X-Workspace-Id';

/** Tenant ID header key. */
const TENANT_ID_HEADER: string = 'X-Tenant-Id';

export { LOCAL_BASE_URL_PREFIX };

/** Build base URL from a connection target. */
export function buildBaseUrl(target: ConnectionTarget): string {
  return target.mode === 'local'
    ? `${LOCAL_BASE_URL_PREFIX}${String(target.port)}`
    : target.apiUrl;
}

/** Build auth headers for cloud mode. Returns empty record for local. */
export function buildAuthHeaders(target: ConnectionTarget): Readonly<Record<string, string>> {
  if (target.mode !== 'cloud') {
    return {};
  }
  return {
    [AUTHORIZATION_HEADER]: `${AUTH_BEARER_PREFIX}${target.apiKey}`,
    [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON,
    [TENANT_ID_HEADER]: target.tenantId,
    [WORKSPACE_ID_HEADER]: target.workspaceId,
  };
}

/** Fetch with auth headers injected for cloud mode. */
export async function fetchWithAuth(
  url: string,
  authHeaders: Readonly<Record<string, string>>,
): Promise<Response> {
  const headers: Headers = new Headers();
  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }
  return await fetch(url, { headers });
}

/** POST JSON with auth headers injected for cloud mode. */
export async function postJsonWithAuth(
  url: string,
  body: Readonly<Record<string, unknown>>,
  authHeaders: Readonly<Record<string, string>>,
): Promise<string> {
  const headers: Headers = new Headers();
  headers.set(CONTENT_TYPE_HEADER, CONTENT_TYPE_JSON);
  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }
  const response: Response = await fetch(url, {
    body: JSON.stringify(body),
    headers,
    method: 'POST',
  });
  return response.text();
}
