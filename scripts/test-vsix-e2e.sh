#!/bin/bash
set -euo pipefail
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPTS/.." && pwd)"
MCP_DIR="$ROOT/too-many-cooks"
VSIX_DIR="$ROOT/too_many_cooks_vscode_extension"
PORT=4040
TEST_WORKSPACE="$ROOT/.test-vsix-workspace"

# Kill any existing server on the port
kill_port() {
  local pids
  pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Killing existing processes on port $PORT: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

kill_port

# 1. Build MCP server
cd "$MCP_DIR"
npm install
npm run build

# 2. Build VSIX
cd "$VSIX_DIR"
npm install
npm run compile
npm run compile:test

# 3. Start MCP server with isolated test workspace (never touches the real data.db)
cleanup_mcp() {
  [ -n "${MCP_PID:-}" ] && kill "$MCP_PID" 2>/dev/null || true
  rm -rf "$TEST_WORKSPACE"
}
trap cleanup_mcp EXIT

kill_port
rm -rf "$TEST_WORKSPACE"
mkdir -p "$TEST_WORKSPACE"

cd "$MCP_DIR"
TMC_WORKSPACE="$TEST_WORKSPACE" node packages/too-many-cooks/build/bin/server.js &
MCP_PID=$!

# Poll until server is ready (max 10s)
for i in $(seq 1 50); do
  if curl -sf http://localhost:$PORT/admin/status >/dev/null 2>&1; then
    echo "MCP server ready (attempt $i)"
    break
  fi
  if [ "$i" -eq 50 ]; then
    echo "MCP server failed to start"
    exit 1
  fi
  sleep 0.2
done

# 4. Run VSIX tests
cd "$VSIX_DIR"
npm run test
