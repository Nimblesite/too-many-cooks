#!/usr/bin/env bash
# [SWR-VERSION-CLI-OUTPUT] [SWR-VSIX-BUNDLE] Prove the staged single-executable
# server for <target> works on THIS machine before it is packaged: `--version`
# is exactly `too-many-cooks <version>`, and it boots from an EMPTY environment
# (no PATH, no Node, no npx), creates its DB with the bundled DataProviderMigrate
# and serves /admin/status. make test and release.yml both run THIS script.
#
# Usage: verify-bundled-server.sh <target> <version>
set -euo pipefail

TARGET="${1:?usage: verify-bundled-server.sh <target> <version>}"
VERSION="${2:?usage: verify-bundled-server.sh <target> <version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXE="$ROOT/too_many_cooks_vscode_extension/bin/$TARGET/too-many-cooks"
if [[ "$TARGET" == win32-* ]]; then EXE="$EXE.exe"; fi
PORT=4199
ATTEMPTS=150
INTERVAL_S=0.2

actual="$("$EXE" --version | head -n1 | tr -d '\r')"
if [ "$actual" != "too-many-cooks $VERSION" ]; then
  echo "::error::$EXE --version printed '$actual', expected 'too-many-cooks $VERSION'"
  exit 1
fi
echo "OK: $actual"

WS="$(mktemp -d)"
# Windows needs SYSTEMROOT for its network stack; nothing else is inherited.
env -i TMC_WORKSPACE="$WS" TMC_PORT="$PORT" SYSTEMROOT="${SYSTEMROOT:-}" "$EXE" > "$WS/server.out" 2>&1 &
PID=$!
# Stop the server and wait for it, so Windows releases its file handles before
# the workspace is removed; cleanup must never change the verdict.
cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  rm -rf "$WS" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq "$ATTEMPTS"); do
  if curl -sf "http://127.0.0.1:$PORT/admin/status" > "$WS/status.json"; then break; fi
  sleep "$INTERVAL_S"
done
if ! grep -q '"agents"' "$WS/status.json" 2>/dev/null; then
  echo "::error::bundled server did not serve /admin/status; its output:"
  cat "$WS/server.out"
  exit 1
fi
if [ ! -f "$WS/.too_many_cooks/data.db" ]; then
  echo "::error::bundled server did not create .too_many_cooks/data.db"
  exit 1
fi
echo "OK: bundled $TARGET server booted from an empty environment and created its DB"
