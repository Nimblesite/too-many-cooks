#!/usr/bin/env bash
# [SWR-VSIX-BUNDLE] Stage the single-executable server for ONE target into the
# extension (bin/<target>/) plus the shipwright.json the extension verifies it
# against. Any other target's binaries are removed first, so a per-platform
# VSIX can never carry a foreign binary ([SWR-VSIX-VERIFY]). make test, make
# vsix and release.yml all stage through THIS script.
#
# Usage: stage-vsix-server.sh [target]   (default: this machine's platform-arch)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/too_many_cooks_vscode_extension"
TARGET="${1:-$(node -p 'process.platform + "-" + process.arch')}"

rm -rf "$EXT/bin"
node "$ROOT/scripts/build-server-sea.mjs" "$TARGET" "$EXT/bin/$TARGET"
cp "$ROOT/shipwright.json" "$EXT/shipwright.json"
echo "Staged too-many-cooks for $TARGET into $EXT/bin/$TARGET"
