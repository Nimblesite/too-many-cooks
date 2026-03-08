---
name: build-extension
description: Build, test, and package the Too Many Cooks VSCode extension
argument-hint: "[build|test|package|install]"
disable-model-invocation: true
allowed-tools: Bash
---

# Build VSCode Extension

Builds the Too Many Cooks VSCode extension (`too_many_cooks_vscode_extension/`).

## Full build (MCP server + extension + .vsix)

```bash
bash too_many_cooks_vscode_extension/build.sh
```

This does:
1. Compiles MCP server: `dart compile js -o build/bin/server.js bin/server.dart`
2. Compiles extension: `dart compile js` → `wrap-extension.js` bridge → `out/lib/extension.js`
3. Packages: `vsce package` → `.vsix` file

## Build MCP server only

```bash
cd too_many_cooks && dart pub get && npm ci
dart compile js -o build/bin/server.js bin/server.dart
```

## Test

```bash
cd too_many_cooks_vscode_extension && npm run pretest && npm test
```
On headless Linux: `xvfb-run -a npm test`

## Install into VSCode

```bash
code --install-extension too_many_cooks_vscode_extension/*.vsix
```

## Architecture

Dart → `dart compile js` → wrapper script → VSCode-compatible JS module.

The wrapper scripts (`scripts/wrap-extension.js`, `scripts/wrap-tests.js`) bridge dart2js output to VSCode's CommonJS `require`/`module.exports` system and inject polyfills needed by dart2js async scheduling.
