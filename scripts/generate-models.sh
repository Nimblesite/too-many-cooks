#!/bin/bash
# Generate Dart and TypeScript model files from the TMC JSON schema.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CODEGEN_DIR="$ROOT_DIR/codegen"
SCHEMA="$ROOT_DIR/too-many-cooks/schema/models.json"
DART_OUT="$ROOT_DIR/too-many-cooks/lib/src/data/types.gen.dart"
TS_OUT="$ROOT_DIR/too_many_cooks_vscode_extension/src/state/types.gen.ts"

echo "Generating models from $SCHEMA..."
cd "$CODEGEN_DIR"
dart run bin/generate.dart "$SCHEMA" "$DART_OUT" "$TS_OUT"

echo "Done."
echo "  Dart: $DART_OUT"
echo "  TypeScript: $TS_OUT"
