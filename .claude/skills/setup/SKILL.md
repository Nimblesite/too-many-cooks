---
name: setup
description: Install development tools (mcp | extension | playwright)
disable-model-invocation: true
allowed-tools: Bash
---

# Setup Development Tools

**Usage**: `/setup <tool>`
- `mcp` — Build the Too Many Cooks MCP server
- `extension` — Build the VSCode extension
- `playwright` — Install Chromium and Playwright for website E2E testing

---

## MCP Server Setup

```bash
cd too_many_cooks && dart pub get && npm ci
dart compile js -o build/bin/server.js bin/server.dart
```

Add to Claude Code:
```bash
claude mcp add --transport http too-many-cooks -- node too_many_cooks/build/bin/server.js
```

---

## VSCode Extension Setup

Build the MCP server first (above), then:

```bash
cd too_many_cooks_vscode_extension
dart pub get
npm ci
npm run compile
npx @vscode/vsce package
code --install-extension *.vsix
```

---

## Playwright Setup

```bash
cd website && npm ci
cd website && npx playwright install --with-deps chromium
```

Run website tests:
```bash
cd website && npm test
```
