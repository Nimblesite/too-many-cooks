<!-- agent-pmo:0b21609 -->
# too-many-cooks — Agent Instructions

> ⚠️ **TOKEN DISCIPLINE.** Check file size first. `Grep` over `Read`. Use `offset`/`limit`.
> Smallest diff that solves the problem. Delete dead code, unused imports, stale comments.
> Call out irrelevant context before proceeding. Bloat degrades reasoning. ⚠️

> Read this file in full. Rules below are NON-NEGOTIABLE — violations are rejected in review.

## Project Overview

Multi-agent coordination MCP server for AI agents editing the same codebase. Includes a VSIX that allows the user to see the interactions and perform admin tasks. The MCP server enforces file locking, plan broadcasting, and message passing between agents to prevent edit collisions.

**Primary language:** TypeScript / Node.js
**Build command:** `make ci`
**Test command:** `make test`
**Lint command:** `make lint`

## Basics
- NEVER KILL (pkill) THE VSCODE PROCESS!!!
- Do not use Git unless asked by user

## Too Many Cooks (Multi-Agent Coordination)
- Register on TMC immediately. Keep your key! It's critical. Do not lose it!
- Check messages regularly, lock files before editing, unlock after
- Don't edit locked files; signal intent via plans and messages

## Branch & Git Discipline ([BRANCH-AGENT])
- **NEVER push to `main` directly.** Every change ships PR → CI green → merge. No exceptions.
- **NEVER list yourself (the agent) as a commit co-author.** No `Co-Authored-By` trailer, no agent attribution.
- **Work on exactly ONE branch at a time.** Reuse the existing feature branch; never open a second.
- **If multiple feature branches already exist, merge them into one FIRST**, before any other work.
- **Worktrees are forbidden.** Never run `git worktree`.

## Autonomous Operation ([AGENT-AUTONOMY])
- **Act autonomously. Do NOT stop to ask the user questions.** When something is ambiguous, choose the most reasonable default, record the assumption, and continue to completion.
- **No mid-task pauses** for confirmation, clarification, or approval. Deliver finished work plus a short summary of any assumptions.
- **Auto-memory is OFF** (`.claude/settings.json` → `"autoMemoryEnabled": false`). All persistent rules go through a reviewed PR to this file — never auto-captured memory. ([AGENT-AUTOMEMORY])

## Hard Rules — Universal (no exceptions)

- **NO git commands.** No `add`, `commit`, `push`, `checkout`, `merge`, `rebase`, etc. CI handles git.
- **ZERO DUPLICATION.** Search before writing. Move code, don't copy it.
- **Literals are illegal.** Move all literals to named constants.
- **No manual serialization or deserialization of JSON.**
- **Switch expressions/ternaries over if/else** (except in declarative contexts).
- **Avoid global state.** If necessary, CENTRALIZE GLOBAL STATE with immutable types.
- **Return `Result<T,E>`** instead of throwing exceptions.
- **NO PLACEHOLDERS** — throw if incomplete.
- **Functions < 20 lines. Files < 500 lines.** Refactor when over.
- **Never delete or skip tests. Never remove assertions.** 100% coverage is the goal.
- **`make test` is FAIL-FAST.** Stops at first failing test. Never `--no-fail-fast`. See REPO-STANDARDS-SPEC [TEST-RULES].
- **`make test` ALWAYS computes coverage AND enforces it.** Threshold lives in `coverage-thresholds.json` at the repo root — NOT env vars, NOT gh repo variables, NOT CI YAML. Below threshold = pipeline fails. Ratchet only. See [COVERAGE-THRESHOLDS-JSON].
- **No linter suppressions.** Fix the code.
- **Spec IDs are hierarchical, non-numeric: `[GROUP-TOPIC]` / `[GROUP-TOPIC-DETAIL]`** (e.g., `[LOCK-ACQUIRE]`, `[MSG-DELIVERY]`). Same-group sections sit adjacent in the TOC. NO sequential numbers (`[SPEC-001]`). Code/tests/docs implementing a spec section MUST reference its ID in a comment so `grep [LOCK-` finds spec → code → tests in one shot.
- Databases MUST enforce referential integrity, but delete cascade is ok.
- There is NO legacy DB support. If the DB schema is stale or corrupted, DELETE it and let the server recreate it from scratch. Do NOT write migration code for old schemas.

## TypeScript Rules

- Turn ALL lints on and turn them to error.
- AVOID `any`! Use proper types, generics, and type guards.
- Prefer interfaces/type aliases over classes for data (structural typing).
- **ILLEGAL: non-null assertion `!`, type assertion `as`, `.then()` (use async/await).** Use type narrowing.
- No `// @ts-ignore` / `@ts-nocheck`.
- No implicit `any` — annotate every parameter and return type.
- `tsconfig.json` MUST have `"strict": true`.
- No throwing — return `Result<T,E>` (use `neverthrow`).

## Logging Standards

- **Structured logging library only.** Never `console.log`/`println`/`Debug.WriteLine` for diagnostics. TypeScript: `pino`.
- **Log at entry/exit of significant operations.** Levels: `error|warn|info|debug|trace`. Silent failures are forbidden.
- **Structured fields, not string interpolation.** `{ agentId: 42, action: "lock-acquire" }` — never `"agent 42 acquired lock"`.
- **VS Code extension:** detailed logs to a file in the extension's state folder (`.too_many_cooks/` in workspace root) AND to the VS Code Output Channel.
- **MCP server:** persist logs to file; writes MUST be async — never block the request path.
- **NEVER log PII** (names, emails, phone, IPs unless audit with consent).
- **NEVER log secrets.** Log `"key: present"` or a truncated hash, never the value. The TMC registration key is a secret.

## Testing Rules

- 100% coverage with high-level integration tests, not unit tests/mocks.
- Tests in separate files, not groups.
- Never skip tests. Never remove assertions. Failing tests OK, silent failures = ILLEGAL. Aggressively unskip tests.
- Make sure the logs are giving you enough information to diagnose the issue. If not, add logging.
- **Specific assertions only.** `assert.ok(true)` is illegal.
- **No try/catch in tests that swallows exceptions and asserts success.**
- **Deterministic.** No `sleep()`, no timing dependencies, no random state.
- **E2E tests: black-box only** — public APIs, UI, or CLI. Never reach into internals.
- **VS Code extension E2E:** interact only via `vscode.commands.executeCommand`.

## Bug Fix Process

- Do not fix the bug immediately.
- Write a test that fails because of the bug.
- Run the test.
- Confirm that it fails BECAUSE of the bug.
- Repeat until it's failing BECAUSE of the bug.
- Fix the bug.
- You are not allowed to change the test.
- Run the test.
- Confirm that it passes or repeat until the bug is fixed.

## Build Commands

Cross-platform GNU Make. On Windows: `choco install make` or use the one in Git for Windows.

```bash
make build   # compile everything (MCP server, VS Code extension, website)
make test    # FAIL-FAST tests + coverage + threshold (ONLY test entry point)
make lint    # all linters/analyzers (no formatting)
make fmt     # format in place
make clean   # remove build artifacts
make ci      # lint + test + build (full CI simulation)
make setup   # install dependencies for all sub-packages
```

**There are exactly 7 targets. No others.** `make test` runs the test runner with its fail-fast flag, collects coverage, asserts measured ≥ threshold from `coverage-thresholds.json`, and exits non-zero on any failure. To debug a single test, invoke the runner directly — that is not a Makefile target.

**`make fmt`** formats code in-place. **`make lint`** runs linters/analyzers (read-only, no formatting). **`make test`** runs tests with coverage. Three separate targets — no overlap.

## Web & SEO

When generating web content for the `website/` Eleventy site, read these first:

- [Succeeding in AI Search](https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search)
- [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Using Gen AI Content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content)

## Codebase Structure

```
too-many-cooks/                     # MCP server (TypeScript/Node.js), monorepo with packages/
  packages/
    core/                           # shared core types and utilities
    too-many-cooks/                 # the MCP server entrypoint
too_many_cooks_vscode_extension/    # VSCode extension (TypeScript)
website/                            # Documentation website (Eleventy)
scripts/                            # Build/test scripts (generate-models.sh runs typeDiagram model gen)
docs/                               # specs/ (behavior) and plans/ (TODO checklists)
```
