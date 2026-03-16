#!/usr/bin/env bash
set -euo pipefail
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPTS/.." && pwd)"
MCP_DIR="$ROOT/too-many-cooks"
VSIX_DIR="$ROOT/too_many_cooks_vscode_extension"
PORT=4040
TEST_WORKSPACE="$ROOT/.test-workspace"
MCP_PID=""

# ── MCP server lifecycle ──────────────────────────────────────────────────────
kill_port() {
  local pids
  pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
  [ -n "$pids" ] && echo "$pids" | xargs kill -9 2>/dev/null || true
}

start_server() {
  kill_port
  rm -rf "$TEST_WORKSPACE"
  mkdir -p "$TEST_WORKSPACE"
  TMC_WORKSPACE="$TEST_WORKSPACE" node "$MCP_DIR/packages/local/build/bin/server.js" &
  MCP_PID=$!
  for i in $(seq 1 50); do
    if curl -sf "http://localhost:$PORT/admin/status" >/dev/null 2>&1; then
      echo "MCP server ready (attempt $i)"
      return
    fi
    [ "$i" -eq 50 ] && echo "MCP server failed to start" && exit 1
    sleep 0.2
  done
}

cleanup() {
  [ -n "$MCP_PID" ] && kill "$MCP_PID" 2>/dev/null || true
  rm -rf "$TEST_WORKSPACE"
}
trap cleanup EXIT

# ── Build ─────────────────────────────────────────────────────────────────────
echo "========================================="
echo "  Build"
echo "========================================="
cd "$MCP_DIR"
npm run build
cd "$VSIX_DIR"
npm run compile
npm run compile:test

# ── Start MCP server (needed for cloud-proxy and VSIX e2e tests) ─────────────
start_server

# ── local: tests + coverage ──────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  local: tests + coverage"
echo "========================================="
cd "$MCP_DIR"
npm run test:coverage -w packages/local

# ── cloud-proxy: tests + coverage ────────────────────────────────────────────
echo ""
echo "========================================="
echo "  cloud-proxy: tests + coverage"
echo "========================================="
npm run test:coverage -w packages/cloud-proxy

# ── VSIX: pure unit tests + coverage ─────────────────────────────────────────
echo ""
echo "========================================="
echo "  VSIX: pure unit tests + coverage"
echo "========================================="
cd "$VSIX_DIR"
npm run test:coverage

# ── VSIX: e2e tests + coverage ───────────────────────────────────────────────
echo ""
echo "========================================="
echo "  VSIX: e2e tests + coverage"
echo "========================================="
npm run test:coverage:integration

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  Coverage reports"
echo "========================================="
echo "  local:        $MCP_DIR/packages/local/coverage/index.html"
echo "  cloud-proxy:  $MCP_DIR/packages/cloud-proxy/coverage/index.html"
echo "  VSIX pure:    $VSIX_DIR/coverage/index.html"
echo "  VSIX e2e:     $VSIX_DIR/coverage-integration/index.html"
echo "========================================="
