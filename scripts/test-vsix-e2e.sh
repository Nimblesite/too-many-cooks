#!/bin/bash
set -euo pipefail
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPTS/.." && pwd)"
MCP_DIR="$ROOT/too-many-cooks"
VSIX_DIR="$ROOT/too_many_cooks_vscode_extension"

# 1. Build MCP server
cd "$MCP_DIR"
npm install
npm run build

# 2. Build VSIX
cd "$VSIX_DIR"
npm install
npm run compile
npm run compile:test

# 3. Start MCP server
cleanup_mcp() { [ -n "${MCP_PID:-}" ] && kill "$MCP_PID" 2>/dev/null || true; }
trap cleanup_mcp EXIT
cd "$MCP_DIR"
node --import tsx bin/server.ts &
MCP_PID=$!

# Poll until server is ready (max 10s)
for i in $(seq 1 50); do
  if curl -sf http://localhost:4040/admin/status >/dev/null 2>&1; then
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
