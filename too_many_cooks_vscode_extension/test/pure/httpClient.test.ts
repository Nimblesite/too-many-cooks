/// Tests for httpClient pure helper functions.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseStreamableHttpResponse } from '../../src/services/httpClient';
import { describeIsRecordSuite } from './testSupport';

/** assert.throws predicate: any Error whose message contains the fragment. */
function isErrorWith(fragment = ''): (err: unknown) => boolean {
  return (err: unknown): boolean => err instanceof Error && err.message.includes(fragment);
}

/** Assert a stream payload parses to a record carrying the given id. */
function assertParsedId(streamText: string, expectedId: number): void {
  const result: Record<string, unknown> = parseStreamableHttpResponse(streamText);
  assert.strictEqual(result.id, expectedId);
}

describeIsRecordSuite();

describe('parseStreamableHttpResponse', () => {
  it('parses direct JSON response', () => {
    const result: Record<string, unknown> = parseStreamableHttpResponse('{"id":1,"result":{"ok":true}}');
    assert.strictEqual(result.id, 1);
    assert.notStrictEqual(result.result, undefined);
  });

  it('parses JSON with leading whitespace', () => {
    assertParsedId('  {"id":1}', 1);
  });

  it('parses Streamable HTTP event-stream format', () => {
    const streamText: string = 'event: message\ndata: {"id":1,"result":{"content":[]}}\n\n';
    const result: Record<string, unknown> = parseStreamableHttpResponse(streamText);
    assert.strictEqual(result.id, 1);
  });

  it('skips non-data stream lines', () => {
    assertParsedId('event: message\nid: 123\ndata: {"id":1}\n\n', 1);
  });

  it('throws for invalid JSON response', () => {
    assert.throws(
      (): void => { parseStreamableHttpResponse('not valid json at all'); },
      isErrorWith(),
    );
  });

  it('throws for empty stream with no parseable data', () => {
    assert.throws(
      (): void => { parseStreamableHttpResponse('event: message\nid: 123\n\n'); },
      isErrorWith('Could not parse'),
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
    assertParsedId('data: not-valid-json\ndata: {"id":2}\n\n', 2);
  });

  it('skips stream data lines that parse to non-records', () => {
    assertParsedId('data: "just-a-string"\ndata: 42\ndata: {"id":3}\n\n', 3);
  });
});
