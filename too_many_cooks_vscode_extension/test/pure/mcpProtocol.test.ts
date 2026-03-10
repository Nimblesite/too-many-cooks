/// Tests for mcpProtocol pure helper functions.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import 'module-alias/register';
import { extractToolResultText } from 'services/mcpProtocol';

describe('extractToolResultText', () => {
  it('extracts text from valid content array', () => {
    const result: Record<string, unknown> = {
      content: [{ type: 'text', text: '{"agent_name":"test"}' }],
    };
    assert.strictEqual(extractToolResultText(result), '{"agent_name":"test"}');
  });

  it('returns error for empty content array', () => {
    const result: Record<string, unknown> = { content: [] };
    assert.strictEqual(extractToolResultText(result), '{"error":"No content"}');
  });

  it('returns error for missing content', () => {
    const result: Record<string, unknown> = {};
    assert.strictEqual(extractToolResultText(result), '{"error":"No content"}');
  });

  it('returns error for non-array content', () => {
    const result: Record<string, unknown> = { content: 'not-array' };
    assert.strictEqual(extractToolResultText(result), '{"error":"No content"}');
  });

  it('returns error for non-record first item', () => {
    const result: Record<string, unknown> = { content: ['not-a-record'] };
    assert.strictEqual(extractToolResultText(result), '{"error":"Invalid content"}');
  });

  it('returns error for missing text field', () => {
    const result: Record<string, unknown> = { content: [{ type: 'image' }] };
    assert.strictEqual(extractToolResultText(result), '{"error":"No text content"}');
  });

  it('returns error for non-string text field', () => {
    const result: Record<string, unknown> = { content: [{ type: 'text', text: 42 }] };
    assert.strictEqual(extractToolResultText(result), '{"error":"No text content"}');
  });
});
