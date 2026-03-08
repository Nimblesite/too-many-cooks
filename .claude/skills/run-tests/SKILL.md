---
name: run-tests
description: Run tests for Too Many Cooks packages. Detects which packages to test based on changed files.
argument-hint: "[mcp|data|extension|all]"
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob
---

# Run Tests

## Step 1: Determine what to test

If `$ARGUMENTS` specifies a package, use that. Otherwise detect from changed files:

```bash
git diff --name-only main
```

| Changed path | Test target |
|---|---|
| `too_many_cooks/` | `too_many_cooks` |
| `too_many_cooks_vscode_extension/` | `too_many_cooks_vscode_extension` |

## Step 2: Run tests

**Data layer:**
```bash
```

**MCP server (integration):**
```bash
cd too_many_cooks && dart test
```

**VSCode extension** (requires display):
```bash
cd too_many_cooks_vscode_extension && npm run pretest && npm test
```
On headless Linux, prefix with `xvfb-run -a`.

**All:**
```bash
cd ../too_many_cooks && dart test
```

## After running

1. Report PASS/FAIL per package
2. If failures occur, read the output and diagnose
3. Never skip tests, remove assertions, or silently swallow failures
