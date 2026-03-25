/// Tests for MCP Config Manager — agent detection and config writing.
///
/// Phase 7 of the VSIX connection switcher.
/// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
/// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMcpConfigManager } from '../../src/services/mcpConfigManager';
import type { McpConfigManager } from '../../src/services/mcpConfigManager';
import type { AgentType } from '../../src/services/connectionTypes';

const MCP_SERVER_NAME = 'too-many-cooks';
const MCP_SERVERS_KEY = 'mcpServers';
const TEST_PORT = 4040;
const TEST_API_KEY = 'test-api-key-abc123';
const TEST_WORKSPACE_ID = 'ws-id-456';
const TEST_PASSPHRASE = 'test-passphrase';
const EXPECTED_HTTP_URL = `http://localhost:${TEST_PORT}/mcp`;

const logs: string[] = [];
const log = (msg: string): void => { logs.push(msg); };

let tempDir: string;
let manager: McpConfigManager;

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;

describe('McpConfigManager', () => {
  beforeEach(() => {
    logs.length = 0;
    tempDir = mkdtempSync(join(tmpdir(), 'tmc-test-'));
    manager = createMcpConfigManager(tempDir, log);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detectAgents', () => {
    it('returns empty array when no agent markers exist', () => {
      const agents = manager.detectAgents();
      assert.strictEqual(agents.length, 0);
    });

    it('detects claude-code when .claude directory exists', () => {
      mkdirSync(join(tempDir, '.claude'));
      const agents = manager.detectAgents();
      assert.deepStrictEqual(agents, ['claude-code']);
    });

    it('detects cursor when .cursor directory exists', () => {
      mkdirSync(join(tempDir, '.cursor'));
      const agents = manager.detectAgents();
      assert.deepStrictEqual(agents, ['cursor']);
    });

    it('detects cline when .cline directory exists', () => {
      mkdirSync(join(tempDir, '.cline'));
      const agents = manager.detectAgents();
      assert.deepStrictEqual(agents, ['cline']);
    });

    it('detects codex when .codex directory exists', () => {
      mkdirSync(join(tempDir, '.codex'));
      const agents = manager.detectAgents();
      assert.deepStrictEqual(agents, ['codex']);
    });

    it('detects multiple agents', () => {
      mkdirSync(join(tempDir, '.claude'));
      mkdirSync(join(tempDir, '.cursor'));
      mkdirSync(join(tempDir, '.cline'));
      const agents = manager.detectAgents();
      assert.deepStrictEqual(agents, ['claude-code', 'cline', 'cursor']);
    });
  });

  describe('writeHttpStreamableConfig', () => {
    it('writes HTTP config to claude-code .mcp.json', () => {
      const agents: AgentType[] = ['claude-code'];
      manager.writeHttpStreamableConfig(agents, TEST_PORT);

      const configPath = join(tempDir, '.mcp.json');
      const config = readJson(configPath);
      const servers = config[MCP_SERVERS_KEY] as Record<string, unknown>;
      const tmcConfig = servers[MCP_SERVER_NAME] as Record<string, unknown>;

      assert.strictEqual(tmcConfig.url, EXPECTED_HTTP_URL);
    });

    it('writes HTTP config to cursor .cursor/mcp.json', () => {
      const agents: AgentType[] = ['cursor'];
      manager.writeHttpStreamableConfig(agents, TEST_PORT);

      const configPath = join(tempDir, '.cursor', 'mcp.json');
      const config = readJson(configPath);
      const servers = config[MCP_SERVERS_KEY] as Record<string, unknown>;
      const tmcConfig = servers[MCP_SERVER_NAME] as Record<string, unknown>;

      assert.strictEqual(tmcConfig.url, EXPECTED_HTTP_URL);
    });

    it('preserves existing servers in config', () => {
      const configPath = join(tempDir, '.mcp.json');
      writeFileSync(configPath, JSON.stringify({
        [MCP_SERVERS_KEY]: { 'other-server': { url: 'http://example.com' } },
      }));

      manager.writeHttpStreamableConfig(['claude-code'], TEST_PORT);

      const config = readJson(configPath);
      const servers = config[MCP_SERVERS_KEY] as Record<string, unknown>;

      assert.strictEqual(Object.keys(servers).length, 2);
      assert.ok(servers['other-server']);
      assert.ok(servers[MCP_SERVER_NAME]);
    });

    it('creates parent directories if missing', () => {
      manager.writeHttpStreamableConfig(['cursor'], TEST_PORT);
      const configPath = join(tempDir, '.cursor', 'mcp.json');
      const config = readJson(configPath);
      assert.ok(config[MCP_SERVERS_KEY]);
    });
  });

  describe('writeStdioConfig', () => {
    it('writes stdio config with env vars', () => {
      manager.writeStdioConfig(['claude-code'], {
        apiKey: TEST_API_KEY,
        workspaceId: TEST_WORKSPACE_ID,
        passphrase: TEST_PASSPHRASE,
      });

      const configPath = join(tempDir, '.mcp.json');
      const config = readJson(configPath);
      const servers = config[MCP_SERVERS_KEY] as Record<string, unknown>;
      const tmcConfig = servers[MCP_SERVER_NAME] as Record<string, unknown>;

      assert.strictEqual(tmcConfig.command, 'npx');
      assert.deepStrictEqual(tmcConfig.args, ['too-many-cooks', '--stdio']);

      const env = tmcConfig.env as Record<string, string>;
      assert.strictEqual(env.TMC_API_KEY, TEST_API_KEY);
      assert.strictEqual(env.TMC_WORKSPACE_ID, TEST_WORKSPACE_ID);
      assert.strictEqual(env.TMC_WORKSPACE_SECRET, TEST_PASSPHRASE);
    });

    it('writes to multiple agents', () => {
      mkdirSync(join(tempDir, '.cursor'));
      manager.writeStdioConfig(
        ['claude-code', 'cursor'],
        { apiKey: TEST_API_KEY, workspaceId: TEST_WORKSPACE_ID, passphrase: TEST_PASSPHRASE },
      );

      const claudeConfig = readJson(join(tempDir, '.mcp.json'));
      const cursorConfig = readJson(join(tempDir, '.cursor', 'mcp.json'));

      const claudeServers = claudeConfig[MCP_SERVERS_KEY] as Record<string, unknown>;
      const cursorServers = cursorConfig[MCP_SERVERS_KEY] as Record<string, unknown>;

      assert.ok(claudeServers[MCP_SERVER_NAME]);
      assert.ok(cursorServers[MCP_SERVER_NAME]);
    });
  });

  describe('removeConfig', () => {
    it('removes too-many-cooks entry from agent config', () => {
      manager.writeHttpStreamableConfig(['claude-code'], TEST_PORT);

      const configPath = join(tempDir, '.mcp.json');
      let config = readJson(configPath);
      let servers = config[MCP_SERVERS_KEY] as Record<string, unknown>;
      assert.ok(servers[MCP_SERVER_NAME]);

      manager.removeConfig(['claude-code']);

      config = readJson(configPath);
      servers = config[MCP_SERVERS_KEY] as Record<string, unknown>;
      assert.strictEqual(servers[MCP_SERVER_NAME], undefined);
    });

    it('preserves other servers when removing', () => {
      const configPath = join(tempDir, '.mcp.json');
      writeFileSync(configPath, JSON.stringify({
        [MCP_SERVERS_KEY]: {
          'other-server': { url: 'http://example.com' },
          [MCP_SERVER_NAME]: { url: EXPECTED_HTTP_URL },
        },
      }));

      manager.removeConfig(['claude-code']);

      const config = readJson(configPath);
      const servers = config[MCP_SERVERS_KEY] as Record<string, unknown>;
      assert.ok(servers['other-server']);
      assert.strictEqual(servers[MCP_SERVER_NAME], undefined);
    });

    it('handles missing config file gracefully', () => {
      assert.doesNotThrow(() => {
        manager.removeConfig(['claude-code']);
      });
    });
  });

  describe('getConfigPath', () => {
    it('returns correct path for claude-code', () => {
      assert.strictEqual(manager.getConfigPath('claude-code'), join(tempDir, '.mcp.json'));
    });

    it('returns correct path for cursor', () => {
      assert.strictEqual(manager.getConfigPath('cursor'), join(tempDir, '.cursor', 'mcp.json'));
    });

    it('returns correct path for cline', () => {
      assert.strictEqual(manager.getConfigPath('cline'), join(tempDir, '.cline', 'mcp_settings.json'));
    });

    it('returns correct path for codex', () => {
      assert.strictEqual(manager.getConfigPath('codex'), join(tempDir, '.codex', 'mcp.json'));
    });
  });
});
