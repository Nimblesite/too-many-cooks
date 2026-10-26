#!/usr/bin/env bash
# [SWR-VSIX-VERIFY] Inspect a per-platform VSIX before it ships: exactly its own
# target's server binary and runtime files, the manifest it verifies against,
# stamped versions everywhere (no 0.0.0-dev placeholder in a release), and no
# sources, tests or foreign-platform binaries. make vsix and release.yml both
# run THIS script.
#
# Usage: verify-vsix.sh <vsix> <target> <version>
set -euo pipefail

VSIX="${1:?usage: verify-vsix.sh <vsix> <target> <version>}"
TARGET="${2:?usage: verify-vsix.sh <vsix> <target> <version>}"
VERSION="${3:?usage: verify-vsix.sh <vsix> <target> <version>}"
EXE="too-many-cooks"
MIGRATE="DataProviderMigrate"
if [[ "$TARGET" == win32-* ]]; then EXE="$EXE.exe"; MIGRATE="$MIGRATE.exe"; fi
BIN="extension/bin/$TARGET"

fail() { echo "::error::$VSIX: $*"; exit 1; }
ENTRIES="$(unzip -Z1 "$VSIX")"

for required in \
  "$BIN/$EXE" "$BIN/better_sqlite3.node" "$BIN/package.json" "$BIN/schema/tmc-schema.yaml" \
  "$BIN/dataprovider/$TARGET/$MIGRATE" "extension/shipwright.json" "extension/package.json" \
  "extension/out/src/extension.js" "extension/node_modules/@nimblesite/shipwright-vscode/package.json"; do
  grep -qxF "$required" <<< "$ENTRIES" || fail "missing $required"
done

foreign="$(grep -E '^extension/bin/' <<< "$ENTRIES" | grep -vE "^$BIN/" || true)"
[ -z "$foreign" ] || fail "foreign-platform files: $foreign"
foreign_dp="$(grep -E "^$BIN/dataprovider/" <<< "$ENTRIES" | grep -vE "^$BIN/dataprovider/$TARGET/" || true)"
[ -z "$foreign_dp" ] || fail "foreign DataProviderMigrate builds: $foreign_dp"
leaked="$(grep -E '^extension/(src|test|out/test)/' <<< "$ENTRIES" || true)"
[ -z "$leaked" ] || fail "sources/tests packaged: $(head -3 <<< "$leaked")"

unzip -p "$VSIX" extension.vsixmanifest | grep -q "TargetPlatform=\"$TARGET\"" || fail "vsixmanifest TargetPlatform is not $TARGET"
[ "$(unzip -p "$VSIX" extension/package.json | jq -r .version)" = "$VERSION" ] || fail "extension version is not $VERSION"
[ "$(unzip -p "$VSIX" "$BIN/package.json" | jq -r .version)" = "$VERSION" ] || fail "bundled server version is not $VERSION"
[ "$(unzip -p "$VSIX" extension/shipwright.json | jq -r .product.version)" = "$VERSION" ] || fail "shipwright.json version is not $VERSION"

echo "OK: $VSIX carries only $TARGET at $VERSION"
