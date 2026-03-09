#!/bin/bash
set -euo pipefail
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPTS/.." && pwd)"

cd "$ROOT/too-many-cooks"
npm test
