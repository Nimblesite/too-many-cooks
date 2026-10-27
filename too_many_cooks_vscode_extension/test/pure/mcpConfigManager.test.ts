/// Tests for MCP Config Manager — agent detection and config writing.
///
/// Phase 7 of the VSIX connection switcher.
/// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
/// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMcpConfigManager } from '../../src/services/mcpConfigManager';
import type { McpConfigManager } from '../../src/services/mcpConfigManager';
import type { AgentType } from '../../src/services/connectionTypes';
import { readJsonRecord, recordAt, requireRecord } from './testSupport';

const MCP_SERVER_NAME = 'too-many-cooks';
const MCP_SERVERS_KEY = 'mcpServers';
const TEST_PORT = 4040;
const TEST_API_KEY = 'test-api-key-abc123';
const TEST_WORKSPACE_ID = 'ws-id-456';
const TEST_PASSPHRASE = 'test-passphrase';
const EXPECTED_HTTP_URL = `http://localhost:${TEST_PORT}/mcp`;

const logs: string[] = [];

function log(msg: string): void { logs.push(msg); }

let tempDir: string;
let manager: McpConfigManager;

/** Read a config file's mcpServers map. */
function readServers(path: string): Record<string, unknown> {
  return recordAt(readJsonRecord(path), MCP_SERVERS_KEY);
}

/** Read the too-many-cooks entry of a config file. */
function readTmcConfig(path: string): Record<string, unknown> {
  return recordAt(readServers(path), MCP_SERVER_NAME);
}

/** Agent config file locations, relative to the workspace folder. */
const AGENT_CONFIG_PATHS: readonly (readonly [AgentType, readonly string[]])[] = [
  ['claude-code', ['.mcp.json']],
  ['cursor', ['.cursor', 'mcp.json']],
  ['cline', ['.cline', 'mcp_settings.json']],
  ['codex', ['.codex', 'mcp.json']],
];

/** Stdio credential block written to every agent config. */
const STDIO_CREDENTIALS = {
  apiKey: TEST_API_KEY,
  workspaceId: TEST_WORKSPACE_ID,
  passphrase: TEST_PASSPHRASE,
};

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

    const markerCases: ReadonlyArray<readonly [string, AgentType]> = [
      ['.claude', 'claude-code'],
      ['.cursor', 'cursor'],
      ['.cline', 'cline'],
      ['.codex', 'codex'],
    ];

    markerCases.forEach(([marker, expectedAgent]: readonly [string, AgentType]): void => {
      it(`detects ${expectedAgent} when ${marker} directory exists`, () => {
        mkdirSync(join(tempDir, marker));
        const agents = manager.detectAgents();
        assert.deepStrictEqual(agents, [expectedAgent]);
      });
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
    AGENT_CONFIG_PATHS.forEach(([agent, segments]) => {
      it(`writes HTTP config to ${agent} ${segments.join('/')}`, () => {
        manager.writeHttpStreamableConfig([agent], TEST_PORT);

        const tmcConfig = readTmcConfig(join(tempDir, ...segments));
        assert.strictEqual(tmcConfig.url, EXPECTED_HTTP_URL);
      });
    });

    it('preserves existing servers in config', () => {
      const configPath = join(tempDir, '.mcp.json');
      writeFileSync(configPath, JSON.stringify({
        [MCP_SERVERS_KEY]: { 'other-server': { url: 'http://example.com' } },
      }));

      manager.writeHttpStreamableConfig(['claude-code'], TEST_PORT);

      const servers = readServers(configPath);
      assert.strictEqual(Object.keys(servers).length, 2);
      assert.ok(servers['other-server']);
      assert.ok(servers[MCP_SERVER_NAME]);
    });

    it('creates parent directories if missing', () => {
      manager.writeHttpStreamableConfig(['cursor'], TEST_PORT);
      const configPath = join(tempDir, '.cursor', 'mcp.json');
      const config = readJsonRecord(configPath);
      assert.ok(config[MCP_SERVERS_KEY]);
    });
  });

  describe('writeStdioConfig', () => {
    it('writes stdio config with env vars', () => {
      manager.writeStdioConfig(['claude-code'], STDIO_CREDENTIALS);

      const tmcConfig = readTmcConfig(join(tempDir, '.mcp.json'));
      assert.strictEqual(tmcConfig.command, 'npx');
      assert.deepStrictEqual(tmcConfig.args, ['too-many-cooks', '--stdio']);

      const env = requireRecord(tmcConfig.env, 'env');
      assert.strictEqual(env.TMC_API_KEY, TEST_API_KEY);
      assert.strictEqual(env.TMC_WORKSPACE_ID, TEST_WORKSPACE_ID);
      assert.strictEqual(env.TMC_WORKSPACE_SECRET, TEST_PASSPHRASE);
    });

    it('writes to multiple agents', () => {
      mkdirSync(join(tempDir, '.cursor'));
      manager.writeStdioConfig(['claude-code', 'cursor'], STDIO_CREDENTIALS);

      assert.ok(readServers(join(tempDir, '.mcp.json'))[MCP_SERVER_NAME]);
      assert.ok(readServers(join(tempDir, '.cursor', 'mcp.json'))[MCP_SERVER_NAME]);
    });
  });

  describe('removeConfig', () => {
    it('removes too-many-cooks entry from agent config', () => {
      manager.writeHttpStreamableConfig(['claude-code'], TEST_PORT);

      const configPath = join(tempDir, '.mcp.json');
      assert.ok(readServers(configPath)[MCP_SERVER_NAME]);

      manager.removeConfig(['claude-code']);

      assert.strictEqual(readServers(configPath)[MCP_SERVER_NAME], undefined);
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

      const servers = readServers(configPath);
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
    AGENT_CONFIG_PATHS.forEach(([agent, segments]) => {
      it(`returns correct path for ${agent}`, () => {
        assert.strictEqual(manager.getConfigPath(agent), join(tempDir, ...segments));
      });
    });
  });
});
