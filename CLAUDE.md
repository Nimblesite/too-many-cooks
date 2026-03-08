# CLAUDE.md

Multi-agent coordination MCP server for AI agents editing the same codebase. Includes a VSIX that allows the user to see the interactions and perform admin tasks.

## Rules

## Basics
- NEVER KILL (pkill) THE VSCODE PROCESS!!!
- Do not use Git unless asked by user

## Multi-Agent Coordination (Too Many Cooks)
- Keep your key! It's critical. Do not lose it!
- Check messages regularly, lock files before editing, unlock after
- Don't edit locked files; signal intent via plans and messages

### Code

- Literals are illegal. Move all literals to named constants
- NO DUPLICATION. search before adding, move don't copy
- Functions < 20 lines, files < 500 LOC
- Switch expressions/ternaries over if/else (except in declarative contexts)
- NO GLOBAL STATE. Keep all app state in one place. 
- Return `Result<T,E>` instead of throwing exceptions

### Dart
- All Dart, minimal JS. Use `dart:js_interop` (not deprecated `dart:js_util`/`package:js`)
- AVOID `JSObject`/`JSAny`/`dynamic`!
- Prefer typedef records over classes for data (structural typing)
- ILLEGAL: `as`, `late`, `!`, `.then()`, global state
- All packages require: `austerity` (linting), `nadz` (Result types)
- `node_preamble` for dart2js Node.js compatibility

### Typescript
- Turn ALL lints on and turn them to error

### Testing
- 100% coverage with high-level integration tests, not unit tests/mocks
- Tests in separate files, not groups. Dart only (JS only for interop testing)
- Never skip tests. Never remove assertions. Failing tests OK, silent failures = ⛔️ ILLEGAL. Aggressively unskip tests.
- NO PLACEHOLDERS—throw if incomplete

# Web & Translation

Always read these documents when generating web content. Optimize for AI Search and SEO. 

- [Top ways to ensure your content performs well in Google's AI experiences on Search](https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search)
- [Search Engine Optimization (SEO) Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Google Search's guidance on using generative AI content on your website](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content)

## Codebase Structure

```
too_many_cooks/                     # MCP server (Dart/Node.js)

too_many_cooks_vscode_extension/    # VSCode extension (TypeScript/Dart)
docs/                               # Specification
website/                            # Documentation website (Eleventy)
scripts/                            # Build/test scripts
```
