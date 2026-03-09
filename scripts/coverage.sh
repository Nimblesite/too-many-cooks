#!/bin/bash
set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPTS/.." && pwd)"
MCP_DIR="$ROOT/too-many-cooks"
DART_NODE="$(cd "$ROOT/../dart_node" && pwd)"
COV_PKG="$DART_NODE/packages/dart_node_coverage"

echo "=== Running coverage for too-many-cooks ==="
cd "$MCP_DIR"
dart run "$COV_PKG/bin/coverage.dart" . -o coverage/lcov.info

echo ""
echo "=== Coverage Summary ==="
if command -v lcov &>/dev/null; then
  lcov --summary coverage/lcov.info 2>&1
elif command -v genhtml &>/dev/null; then
  genhtml coverage/lcov.info -o coverage/html --quiet
  echo "HTML report: $MCP_DIR/coverage/html/index.html"
else
  # Parse LCOV manually for a quick summary
  total=0
  hit=0
  while IFS= read -r line; do
    case "$line" in
      LF:*) total=$((total + ${line#LF:})) ;;
      LH:*) hit=$((hit + ${line#LH:})) ;;
    esac
  done < coverage/lcov.info
  if [ "$total" -gt 0 ]; then
    pct=$((hit * 100 / total))
    echo "Lines: $hit/$total ($pct%)"
  else
    echo "No coverage data found"
  fi
fi

echo ""
echo "LCOV file: $MCP_DIR/coverage/lcov.info"
