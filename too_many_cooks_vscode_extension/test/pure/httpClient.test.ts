/// Tests for httpClient pure helper functions.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import 'module-alias/register';
import { isRecord, parseStreamableHttpResponse } from 'services/httpClient';

describe('isRecord', () => {
  it('returns true for plain objects', () => {
    assert.strictEqual(isRecord({}), true);
    assert.strictEqual(isRecord({ key: 'val' }), true);
  });

  it('returns false for non-objects', () => {
    assert.strictEqual(isRecord(null), false);
    assert.strictEqual(isRecord([]), false);
    assert.strictEqual(isRecord('string'), false);
    assert.strictEqual(isRecord(42), false);
    assert.strictEqual(isRecord(undefined), false);
    assert.strictEqual(isRecord(true), false);
  });
});

describe('parseStreamableHttpResponse', () => {
  it('parses direct JSON response', () => {
    const result: Record<string, unknown> = parseStreamableHttpResponse('{"id":1,"result":{"ok":true}}');
    assert.strictEqual(result.id, 1);
    assert.notStrictEqual(result.result, undefined);
  });

  it('parses JSON with leading whitespace', () => {
    const result: Record<string, unknown> = parseStreamableHttpResponse('  {"id":1}');
    assert.strictEqual(result.id, 1);
  });

  it('parses Streamable HTTP event-stream format', () => {
    const streamText: string = 'event: message\ndata: {"id":1,"result":{"content":[]}}\n\n';
    const result: Record<string, unknown> = parseStreamableHttpResponse(streamText);
    assert.strictEqual(result.id, 1);
  });

  it('skips non-data stream lines', () => {
    const streamText: string = 'event: message\nid: 123\ndata: {"id":1}\n\n';
    const result: Record<string, unknown> = parseStreamableHttpResponse(streamText);
    assert.strictEqual(result.id, 1);
  });

  it('throws for invalid JSON response', () => {
    assert.throws(
      (): void => { parseStreamableHttpResponse('not valid json at all'); },
      (err: unknown): boolean => {
        return err instanceof Error;
      },
    );
  });

  it('throws for empty stream with no parseable data', () => {
    assert.throws(
      (): void => { parseStreamableHttpResponse('event: message\nid: 123\n\n'); },
      (err: unknown): boolean => {
        return err instanceof Error && err.message.includes('Could not parse');
      },
    );
  });

  it('throws when parsed JSON is not a record', () => {
    assert.throws(
      (): void => { parseStreamableHttpResponse('"just a string"'); },
      (err: unknown): boolean => {
        return err instanceof Error;
      },
    );
  });

  it('skips unparseable stream data lines', () => {
    const streamText: string = 'data: not-valid-json\ndata: {"id":2}\n\n';
    const result: Record<string, unknown> = parseStreamableHttpResponse(streamText);
    assert.strictEqual(result.id, 2);
  });

  it('skips stream data lines that parse to non-records', () => {
    const streamText: string = 'data: "just-a-string"\ndata: 42\ndata: {"id":3}\n\n';
    const result: Record<string, unknown> = parseStreamableHttpResponse(streamText);
    assert.strictEqual(result.id, 3);
  });
});
