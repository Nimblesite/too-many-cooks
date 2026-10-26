<!-- agent-pmo:0b21609 -->
# too-many-cooks — Agent Instructions

> ⚠️ **TOKEN DISCIPLINE.** Check file size first. `Grep` over `Read`. Use `offset`/`limit`.
> Smallest diff that solves the problem. Delete dead code, unused imports, stale comments. ⚠️

> Rules below are NON-NEGOTIABLE — violations are rejected in review.

## Project Overview

MCP server that coordinates AI agents editing the same codebase: file locks, plans, and messages prevent edit collisions. The VSIX shows agent activity and performs admin tasks. It must start a server session from a clean machine without failing on DB creation.

**Language:** TypeScript / Node.js · **CI:** `make ci` · **Test:** `make test` · **Lint:** `make lint`

## Basics
- NEVER KILL (pkill) THE VSCODE PROCESS!!!
- Register on Too Many Cooks immediately and KEEP YOUR KEY. Check messages regularly, lock files before editing, unlock after. Don't edit locked files; signal intent via plans and messages.

## Git ([BRANCH-AGENT])
- No git commands unless the user asks.
- **NEVER push to `main`.** Every change ships PR → CI green → merge.
- **Commit and push routinely**
- **NEVER list yourself (the agent) as a commit co-author.** No `Co-Authored-By` trailer, no agent attribution.
- **ONE feature branch at a time.** Reuse the existing one. If several exist, merge them into one FIRST.
- **Worktrees are forbidden.**

## Autonomous Operation ([AGENT-AUTONOMY])
- **Act autonomously.** On ambiguity, choose the most reasonable default, record the assumption, continue to completion. No mid-task pauses for approval.
- **Auto-memory is OFF** (`.claude/settings.json`). Persistent rules go through a reviewed PR to this file. ([AGENT-AUTOMEMORY])
- **Subagents are ILLEGAL.** Delegate legwork to pi agents, in order of preference: Kimi 3.1 → GLM 5.3 → DeepSeek 4.1 (use their flash variants when speed matters). ([AGENT-DELEGATION])

## Duplication — Be Vigilant ([DEDUP-DESLOP])
Duplicate code is the #1 review rejection. Follow [deslop for AI](https://deslop.live/docs/for-ai/):
- **Check before you write.** Call deslop MCP `find-similar` on the snippet you are about to add. Reuse what exists; move code, never copy it.
- **After editing**, run `duplicates` and inspect clusters touching your files with `cluster-by-id`. `identical` → reuse. `nearly_identical` → diff, then extract. `same_behavior`/`loosely_similar` → read both ranges before acting.
- **MCP unavailable?** That is NOT evidence of no duplicates. Run `deslop . --notext --nohtml --no-color`, read `.deslop/deslop-report.json` (parse JSON; use its `schema_doc`), compare before/after on your changed paths.
- Never weaken thresholds to hide a finding. Deliberate duplication needs a recorded reason.

## Hard Rules — Universal
- **Literals are illegal.** Move all literals to named constants.
- **No manual JSON serialization/deserialization.**
- **Dependency security is paramount** Always check packages for vulnerabilities and upgrade where they exist
- **Switch expressions/ternaries over if/else** (except in declarative contexts).
- **Avoid global state.** If necessary, centralize it in immutable types.
- **Return `Result<T,E>`** (`neverthrow`) instead of throwing. **NO PLACEHOLDERS** — throw if incomplete.
- **Functions < 20 lines. Files < 500 lines.**
- **No linter suppressions.** Fix the code.
- **Spec IDs are hierarchical, non-numeric** (`[LOCK-ACQUIRE]`, never `[SPEC-001]`). Code/tests implementing a spec section reference its ID in a comment so `grep [LOCK-` finds spec → code → tests.

## Models — typeDiagram ([MODEL-TYPEDIAGRAM])
- **All models MUST be declared in typeDiagram (`.td`) and code-generated.** Never hand-write model types. Syntax: [language reference](https://typediagram.dev/docs/language-reference.html).
- Generate with `scripts/generate-models.sh` (`typediagram --to typescript`). Output files are `*.gen.ts` — DO NOT EDIT them.
- Current source: `too_many_cooks_vscode_extension/src/state/models.td`. `packages/core/src/types.gen.ts` still needs to be moved into a `.td`.

## Database — DataProvider Migrations ([DB-MIGRATE])
- **Schema is defined ONLY in DataProvider YAML** (`too-many-cooks/packages/too-many-cooks/schema/tmc-schema.yaml`) and applied with the **`DataProviderMigrate` CLI** ([docs](https://dataprovider.tech/docs/migrations/)). The same YAML targets SQLite and PostgreSQL.
- Use the standalone per-platform CLI binaries from [GitHub Releases](https://github.com/Nimblesite/DataProvider/releases), pinned in `scripts/dataprovider-version`. Never shell out to `npx`/network at runtime to create a DB. **Using .NET is ILLEGAL** — no `dotnet` CLI, no installed runtime; ship the self-contained binary (guarded by `test/migrate_no_dotnet_test.ts`).
- **Prisma is banned.** Raw DDL (`CREATE TABLE`, etc.) is ILLEGAL. All schema changes are YAML edits.
- Enforce referential integrity (FKs); `onDelete: Cascade` is fine.
- **No legacy DB support.** If the DB is stale or corrupted, DELETE it and recreate. No migration code for old schemas.

## TypeScript
- ALL lints on, as errors. `tsconfig.json` `"strict": true`.
- **TypeScript 7 or higher — ONE version only**, for compiling AND linting. Lint = `oxlint --type-aware` (oxlint-tsgolint, TS 7) with the shared root `.oxlintrc.json`. ESLint/typescript-eslint are banned (they need the TS 6 API).
- **ILLEGAL:** `any`, non-null `!`, `as` assertions, `.then()`, `@ts-ignore`/`@ts-nocheck`. Use type narrowing and generics.
- Annotate every parameter and return type. Prefer type aliases over classes for data.

## Logging
- **`pino` only** — never `console.log` for diagnostics. Structured fields, not string interpolation.
- Log entry/exit of significant operations. Silent failures are forbidden.
- **VSIX:** log to `.too_many_cooks/` in the workspace AND the Output Channel. **MCP server:** async file logs, never block requests.
- **NEVER log PII or secrets.** Log `"key: present"`, never the TMC key.

## Testing
- 100% coverage goal via high-level integration/E2E tests, not unit tests/mocks. E2E tests are black-box only; VSIX E2E interacts only via `vscode.commands.executeCommand`.
- Tests in separate files. **Never skip or delete tests, never remove assertions.** Failing tests OK; silent failures ILLEGAL.
- Specific assertions only (`assert.ok(true)` is illegal). No try/catch that swallows and asserts success.
- Deterministic: no `sleep()`, no timing dependencies, no random state.
- If logs can't diagnose a failure, add logging.

## Bug Fix Process
1. Write a test that fails BECAUSE of the bug. Run it and confirm the failure cause.
2. Fix the bug. You may NOT change the test.
3. Run the test; repeat until it passes.

## Build Commands

GNU Make (Windows: `choco install make`).

```bash
make build   # compile MCP server, VSIX, website
make test    # FAIL-FAST tests + coverage + threshold (ONLY test entry point)
make lint    # linters/analyzers (read-only)
make fmt     # format in place
make clean   # remove build artifacts
make ci      # lint + test + build
make setup   # install dependencies
```

- These 7 are the standard targets; do not add more (existing dev helpers: `help`, `vsix`, `rebuild-install-vsix`, `website-dev`).
- `make test` is fail-fast (never `--no-fail-fast`) and enforces coverage from `coverage-thresholds.json` only — not env vars or CI YAML. Ratchet up only. To debug one test, invoke the runner directly.

## Web & SEO
Before editing `website/` (Eleventy), read [Succeeding in AI Search](https://developers.google.com/search/blog/2025/05/succeeding-in-ai-search), [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [Using Gen AI Content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content).

## Codebase Structure

```
too-many-cooks/                      # MCP server monorepo (npm workspaces)
  packages/core/                     # shared types, tools, server, DB contract tests
  packages/too-many-cooks/           # server entrypoint: SQLite + encrypted cloud backends
    schema/                          # DataProvider YAML schema (DB source of truth)
  napper/                            # HTTP admin/smoke test suites
too_many_cooks_vscode_extension/     # VSIX (src/state/models.td → types.gen.ts)
website/                             # docs site (Eleventy)
scripts/                             # build/test/codegen scripts
docs/                                # spec.md, specs/ (behaviour specs)
```
