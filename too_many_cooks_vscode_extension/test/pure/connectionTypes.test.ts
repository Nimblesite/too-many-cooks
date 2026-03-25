/// Tests for connection types — type validation for local and cloud targets.
///
/// Phase 7 of the VSIX connection switcher.
/// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
/// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type {
  AgentType,
  CloudTarget,
  ConnectionMode,
  ConnectionTarget,
  HttpStreamableConfig,
  LocalTarget,
  StdioConfig,
  Transport,
} from '../../src/services/connectionTypes';

describe('connectionTypes', () => {
  describe('LocalTarget', () => {
    it('has mode local and transport http-streamable', () => {
      const target: LocalTarget = { mode: 'local', port: 4040, transport: 'http-streamable' };
      assert.strictEqual(target.mode, 'local');
      assert.strictEqual(target.transport, 'http-streamable');
      assert.strictEqual(target.port, 4040);
    });
  });

  describe('CloudTarget', () => {
    it('supports stdio transport', () => {
      const target: CloudTarget = {
        mode: 'cloud',
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        passphrase: 'secret',
        transport: 'stdio',
      };
      assert.strictEqual(target.mode, 'cloud');
      assert.strictEqual(target.transport, 'stdio');
    });

    it('supports http-streamable transport', () => {
      const target: CloudTarget = {
        mode: 'cloud',
        apiUrl: 'https://api.example.com',
        apiKey: 'key',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        passphrase: 'secret',
        transport: 'http-streamable',
      };
      assert.strictEqual(target.transport, 'http-streamable');
    });
  });

  describe('ConnectionTarget discriminated union', () => {
    it('narrows to LocalTarget by mode', () => {
      const target: ConnectionTarget = { mode: 'local', port: 4040, transport: 'http-streamable' };
      if (target.mode === 'local') {
        assert.strictEqual(target.port, 4040);
      } else {
        assert.fail('Should be local');
      }
    });

    it('narrows to CloudTarget by mode', () => {
      const target: ConnectionTarget = {
        mode: 'cloud',
        apiUrl: 'https://x.com',
        apiKey: 'k',
        tenantId: 't',
        workspaceId: 'w',
        passphrase: 'p',
        transport: 'stdio',
      };
      if (target.mode === 'cloud') {
        assert.strictEqual(target.apiUrl, 'https://x.com');
      } else {
        assert.fail('Should be cloud');
      }
    });
  });

  describe('Transport type', () => {
    it('accepts http-streamable', () => {
      const t: Transport = 'http-streamable';
      assert.strictEqual(t, 'http-streamable');
    });

    it('accepts stdio', () => {
      const t: Transport = 'stdio';
      assert.strictEqual(t, 'stdio');
    });
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
