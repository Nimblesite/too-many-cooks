// MCP protocol helpers - session initialization, requests, and tool results.

import { isRecord, parseStreamableHttpResponse, streamableHttpPost } from './httpClient';

interface McpRequestConfig {
  readonly baseUrl: string;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly sessionId: string | null;
}

async function initMcpSession(baseUrl: string, endpoint: string, clientName: string): Promise<string> {
  const body: string = JSON.stringify({
    id: 1,
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      capabilities: {},
      clientInfo: { name: clientName, version: '1.0.0' },
      protocolVersion: '2025-03-26',
    },
  });
  const response: Response = await streamableHttpPost(`${baseUrl}${endpoint}`, body, null);
  const sessionId: string | null = response.headers.get('mcp-session-id');
  if (sessionId === null || sessionId === '') {
    throw new Error('No session ID in response');
  }
  const notifyBody: string = JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  });
  await streamableHttpPost(`${baseUrl}${endpoint}`, notifyBody, sessionId);
  return sessionId;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function extractToolResultText(result: Readonly<Record<string, unknown>>): string {
  const contentArray: unknown = result.content;
  if (!isUnknownArray(contentArray) || contentArray.length === 0) {
    return '{"error":"No content"}';
  }
  const [firstItem]: readonly unknown[] = contentArray;
  if (!isRecord(firstItem)) {
    return '{"error":"Invalid content"}';
  }
  const textValue: unknown = firstItem.text;
  if (typeof textValue === 'string') {
    return textValue;
  }
  return '{"error":"No text content"}';
}

async function mcpJsonRpcRequest(config: Readonly<McpRequestConfig>): Promise<Record<string, unknown>> {
  const body: string = JSON.stringify({
    id: Date.now(),
    jsonrpc: '2.0',
    method: config.method,
    params: config.params,
  });
  const response: Response = await streamableHttpPost(
    `${config.baseUrl}/mcp`,
    body,
    config.sessionId,
  );
  const text: string = await response.text();
  if (text.length === 0) {
    throw new Error('Empty response');
  }
  const json: Record<string, unknown> = parseStreamableHttpResponse(text);
  const jsonError: unknown = json.error;
  if (isRecord(jsonError)) {
    const errorMessage: unknown = jsonError.message;
    if (typeof errorMessage === 'string') {
      throw new Error(errorMessage);
    }
    throw new Error('Error');
  }
  const jsonResult: unknown = json.result;
  if (isRecord(jsonResult)) {
    return jsonResult;
  }
  return {};
}

export { extractToolResultText, initMcpSession, mcpJsonRpcRequest };
