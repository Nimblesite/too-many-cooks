/**
 * Starts the locally built MCP server for the VSIX E2E suite, so `make test`
 * needs no hand-started server. The server runs against a throwaway workspace
 * (never the real .too_many_cooks/data.db) and exercises the real DataProvider
 * schema creation path. If something already answers on the port it is reused
 * and never killed ([SERVER-NO-KILL]).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.TMC_PORT || '4040';
const STATUS_URL = `http://localhost:${PORT}/admin/status`;
const SERVER_ENTRY = path.resolve(
  __dirname, '..', '..', 'too-many-cooks', 'packages', 'too-many-cooks', 'build', 'bin', 'server.js',
);
const POLL_INTERVAL_MS = 200;
const MAX_POLL_ATTEMPTS = 150;

async function isUp() {
  try {
    const res = await fetch(STATUS_URL);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitUntilUp(child) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`MCP server exited early with code ${child.exitCode}`);
    }
    if (await isUp()) { return; }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`MCP server not ready on ${STATUS_URL}`);
}

/** Ensure a server is listening; returns a stop() that only stops what we spawned. */
async function ensureServer(log) {
  if (await isUp()) {
    log('INFO', `Reusing MCP server already running on port ${PORT}`);
    return { stop: () => undefined };
  }
  if (!fs.existsSync(SERVER_ENTRY)) {
    throw new Error(`MCP server not built: ${SERVER_ENTRY} (run 'npm run build' in too-many-cooks)`);
  }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tmc-vsix-e2e-'));
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, TMC_PORT: PORT, TMC_WORKSPACE: workspace },
    stdio: 'inherit',
  });
  await waitUntilUp(child);
  log('INFO', `Started MCP server (pid ${child.pid}) on port ${PORT}, workspace ${workspace}`);
  return {
    stop: () => {
      child.kill();
      fs.rmSync(workspace, { recursive: true, force: true });
    },
  };
}

module.exports = { ensureServer };
