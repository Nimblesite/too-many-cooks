#!/usr/bin/env bash
# Stamp a release version into every published package.json and the
# shipwright.json product version. Sources stay 0.0.0-dev; only release runners
# stamp. release.yml and the stamp tests all call THIS script, so the tested
# stamping path is the shipped one. First-class `npm version` / `npm pkg set` /
# `jq` only — no sed on structured files. [CI-RELEASE] [SWR-VERSION-BUILD-STAMPING]
#
# Usage: stamp-version.sh <version> [repo-root]
set -euo pipefail

VERSION="${1:?usage: stamp-version.sh <version> [repo-root]}"
ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"

stamp() {
  (cd "$1" && npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null)
}

stamp "$ROOT/too-many-cooks/packages/core"
stamp "$ROOT/too-many-cooks/packages/too-many-cooks"
(cd "$ROOT/too-many-cooks/packages/too-many-cooks" && npm pkg set "dependencies.too-many-cooks-core=^$VERSION")
stamp "$ROOT/too_many_cooks_vscode_extension"

MANIFEST="$ROOT/shipwright.json"
jq --arg v "$VERSION" '.product.version = $v' "$MANIFEST" > "$MANIFEST.tmp"
mv "$MANIFEST.tmp" "$MANIFEST"

echo "Stamped version $VERSION under $ROOT"
