#!/bin/bash
set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPTS/.." && pwd)"
MCP_DIR="$ROOT/too-many-cooks"

cleanup() { [ -n "${MCP_PID:-}" ] && kill "$MCP_PID" 2>/dev/null || true; }
trap cleanup EXIT

cd "$MCP_DIR"
node --import tsx bin/server.ts &
MCP_PID=$!

echo "MCP server started (PID: $MCP_PID)"
echo "Press Ctrl+C to stop"
wait "$MCP_PID"
