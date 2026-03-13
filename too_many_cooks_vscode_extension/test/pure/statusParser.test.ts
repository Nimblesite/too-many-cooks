/// Tests for status response parser.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseStatusResponse } from '../../src/services/statusParser';

describe('parseStatusResponse', () => {
  it('parses full status response', () => {
    const json: Record<string, unknown> = {
      agents: [
        { agent_name: 'agent-1', registered_at: 1000, last_active: 2000 },
        { agent_name: 'agent-2', registered_at: 1100, last_active: 2100 },
      ],
      locks: [
        {
          file_path: '/src/test.ts',
          agent_name: 'agent-1',
          acquired_at: 1000,
          expires_at: 70000,
          reason: 'editing',
          version: 1,
        },
      ],
      messages: [
        {
          id: 'msg-1',
          from_agent: 'agent-1',
          to_agent: 'agent-2',
          content: 'hello',
          created_at: 1000,
          read_at: null,
        },
      ],
      plans: [
        {
          agent_name: 'agent-1',
          goal: 'Fix bugs',
          current_task: 'Reading code',
          updated_at: 5000,
        },
      ],
    };

    const result = parseStatusResponse(json);
    assert.strictEqual(result.agents.length, 2);
    assert.strictEqual(result.agents[0]?.agentName, 'agent-1');
    assert.strictEqual(result.locks.length, 1);
    assert.strictEqual(result.locks[0]?.filePath, '/src/test.ts');
    assert.strictEqual(result.messages.length, 1);
    assert.strictEqual(result.messages[0]?.content, 'hello');
    assert.strictEqual(result.plans.length, 1);
    assert.strictEqual(result.plans[0]?.goal, 'Fix bugs');
  });

  it('returns empty arrays for missing fields', () => {
    const result = parseStatusResponse({});
    assert.strictEqual(result.agents.length, 0);
    assert.strictEqual(result.locks.length, 0);
    assert.strictEqual(result.messages.length, 0);
    assert.strictEqual(result.plans.length, 0);
  });

  it('returns empty arrays for non-array fields', () => {
    const result = parseStatusResponse({
      agents: 'not-array',
      locks: 42,
      messages: null,
      plans: {},
    });
    assert.strictEqual(result.agents.length, 0);
    assert.strictEqual(result.locks.length, 0);
    assert.strictEqual(result.messages.length, 0);
    assert.strictEqual(result.plans.length, 0);
  });

  it('filters out non-record items in arrays', () => {
    const result = parseStatusResponse({
      agents: [
        { agent_name: 'valid', registered_at: 1000, last_active: 2000 },
        'not-a-record',
        null,
        42,
      ],
      locks: [],
      messages: [],
      plans: [],
    });
    assert.strictEqual(result.agents.length, 1);
    assert.strictEqual(result.agents[0]?.agentName, 'valid');
  });
});
