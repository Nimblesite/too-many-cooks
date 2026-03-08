# CLAUDE.md

Multi-agent coordination MCP server for AI agents editing the same codebase.

## Rules

⛔️ NEVER KILL (pkill) THE VSCODE PROCESS!!!
- Do not use Git unless asked by user

## Multi-Agent Coordination (Too Many Cooks)
- Keep your key! It's critical. Do not lose it!
- Check messages regularly, lock files before editing, unlock after
- Don't edit locked files; signal intent via plans and messages

**Language & Types**
- All Dart, minimal JS. Use `dart:js_interop` (not deprecated `dart:js_util`/`package:js`)
- AVOID `JSObject`/`JSAny`/`dynamic`!
- Prefer typedef records over classes for data (structural typing)
- Literals are illegal. Move all literals to named constants
- ILLEGAL: `as`, `late`, `!`, `.then()`, global state

**Architecture**
- NO DUPLICATION—search before adding, move don't copy
- Return `Result<T,E>` (nadz) instead of throwing exceptions
- Functions < 20 lines, files < 500 LOC
- Switch expressions/ternaries over if/else (except in declarative contexts)
- Keep all app state in one place. No global state

**Testing**
- 100% coverage with high-level integration tests, not unit tests/mocks
- Tests in separate files, not groups. Dart only (JS only for interop testing)
- Never skip tests. Never remove assertions. Failing tests OK, silent failures = ⛔️ ILLEGAL. Aggressively unskip tests.
- NO PLACEHOLDERS—throw if incomplete

**Dependencies**
- All packages require: `austerity` (linting), `nadz` (Result types)
- `node_preamble` for dart2js Node.js compatibility

**Pull Requests**
- Keep the documentation tight
- Only use git diff with main. Ignore commit messages

# Web & Translation

- Optimize for AI Search and SEO

## Codebase Structure

```
too_many_cooks/           # MCP server (Dart/Node.js)
too_many_cooks_data/      # Data layer (SQLite, types)
too_many_cooks_vscode_extension/ # VSCode extension (TypeScript/Dart)
docs/                     # Specification
website/                  # Documentation website (Eleventy)
scripts/                  # Build/test scripts
```
