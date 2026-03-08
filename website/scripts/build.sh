#\!/bin/bash
set -e

cd "$(dirname "$0")/.." 

npx eleventy
