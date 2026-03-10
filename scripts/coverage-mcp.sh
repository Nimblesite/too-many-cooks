#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MCP_DIR="$ROOT/too-many-cooks"

cd "$MCP_DIR"
rm -rf coverage
mkdir -p coverage
c8 --reporter=lcov --reports-dir=coverage npm test
echo ""
echo "LCOV: $MCP_DIR/coverage/lcov.info"
