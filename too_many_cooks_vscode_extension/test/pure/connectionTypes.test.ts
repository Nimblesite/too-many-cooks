/// Tests for connection types — type validation for local and cloud targets.
///
/// Phase 7 of the VSIX connection switcher.
/// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
/// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { makeCloudTarget, makeLocalTarget } from './testSupport';
import type { AgentType, CloudTarget, ConnectionMode, ConnectionTarget, HttpStreamableConfig, LocalTarget, StdioConfig, Transport } from '../../src/services/connectionTypes';

const DEFAULT_PORT = 4040;

/** Every MCP transport the connection targets support. */
const TRANSPORT_CASES: readonly Transport[] = ['stdio', 'http-streamable'];

describe('connectionTypes', () => {
  describe('LocalTarget', () => {
    it('has mode local and transport http-streamable', () => {
      const target: LocalTarget = makeLocalTarget();
      assert.strictEqual(target.mode, 'local');
      assert.strictEqual(target.transport, 'http-streamable');
      assert.strictEqual(target.port, DEFAULT_PORT);
    });
  });

  describe('CloudTarget', () => {
    for (const transport of TRANSPORT_CASES) {
      it(`supports ${transport} transport`, () => {
        const target: CloudTarget = makeCloudTarget({ transport });
        assert.strictEqual(target.mode, 'cloud');
        assert.strictEqual(target.transport, transport);
      });
    }
  });

  describe('ConnectionTarget discriminated union', () => {
    it('narrows to LocalTarget by mode', () => {
      const target: ConnectionTarget = makeLocalTarget();
      if (target.mode === 'local') {
        assert.strictEqual(target.port, DEFAULT_PORT);
      } else {
        assert.fail('Should be local');
      }
    });

    it('narrows to CloudTarget by mode', () => {
      const target: ConnectionTarget = makeCloudTarget({ apiKey: 'k', apiUrl: 'https://x.com', passphrase: 'p', tenantId: 't', workspaceId: 'w' });
      if (target.mode === 'cloud') {
        assert.strictEqual(target.apiUrl, 'https://x.com');
      } else {
        assert.fail('Should be cloud');
      }
    });
  });

  describe('Transport type', () => {
    for (const transport of TRANSPORT_CASES) {
      it(`accepts ${transport}`, () => {
        const t: Transport = transport;
        assert.strictEqual(t, transport);
      });
    }
  });

  describe('ConnectionMode type', () => {
    it('accepts all three modes', () => {
      const modes: ConnectionMode[] = ['local', 'cloud', 'disconnected'];
      assert.strictEqual(modes.length, 3);
    });
  });

  describe('AgentType', () => {
    it('includes all four agents', () => {
      const agents: AgentType[] = ['claude-code', 'cursor', 'cline', 'codex'];
      assert.strictEqual(agents.length, 4);
    });
  });

  describe('AgentMcpConfig', () => {
    it('HttpStreamableConfig has url', () => {
      const config: HttpStreamableConfig = { url: 'http://localhost:4040/mcp' };
      assert.strictEqual(config.url, 'http://localhost:4040/mcp');
    });

    it('StdioConfig has command, args, env', () => {
      const config: StdioConfig = {
        command: 'npx',
        args: ['too-many-cooks', '--stdio'],
        env: { TMC_API_KEY: 'key' },
      };
      assert.strictEqual(config.command, 'npx');
      assert.deepStrictEqual(config.args, ['too-many-cooks', '--stdio']);
      assert.strictEqual(config.env.TMC_API_KEY, 'key');
    });
  });
});
