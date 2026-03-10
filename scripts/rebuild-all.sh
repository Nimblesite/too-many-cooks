#!/bin/bash
set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPTS/.." && pwd)"
MCP_DIR="$ROOT/too-many-cooks"
VSIX_DIR="$ROOT/too_many_cooks_vscode_extension"
PORT=4040

echo "=== Clean build artifacts ==="
rm -rf "$MCP_DIR/build"
rm -rf "$VSIX_DIR/out"
echo "Cleaned build artifacts (database preserved)"

echo ""
echo "=== Build MCP server (TypeScript) ==="
cd "$MCP_DIR"
npm install
npm run build
echo "MCP server compiled: $MCP_DIR/build/"

echo ""
echo "=== Build VSCode extension (TypeScript) ==="
cd "$VSIX_DIR"
npm install
npm run compile
npm run package
echo "VSCode extension compiled and packaged"

echo ""
echo "=== Starting MCP server on port $PORT ==="
cleanup() { [ -n "${MCP_PID:-}" ] && kill "$MCP_PID" 2>/dev/null || true; }
trap cleanup EXIT

cd "$MCP_DIR"
node --import tsx bin/server.ts &
MCP_PID=$!

for i in $(seq 1 50); do
  if curl -sf "http://localhost:$PORT/admin/status" >/dev/null 2>&1; then
    echo "MCP server ready (PID: $MCP_PID, port: $PORT)"
    break
  fi
  if [ "$i" -eq 50 ]; then
    echo "MCP server failed to start"
    exit 1
  fi
  sleep 0.2
done

echo ""
echo "=== Ready ==="
echo "MCP endpoint:  http://localhost:$PORT/mcp"
echo "Admin status:  http://localhost:$PORT/admin/status"
echo "Admin events:  http://localhost:$PORT/admin/events"
echo "Press Ctrl+C to stop"
wait "$MCP_PID"
