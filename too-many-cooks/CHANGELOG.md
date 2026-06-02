# Changelog

## 0.13.0

### Fixed
- **Two VS Code windows no longer collide on the shared port (#33).** A second server starting on an occupied port used to run `lsof -ti` + `kill -9` and terminate whatever owned the port — including a *different project's* server, which then EPIPE-looped into a multi-gigabyte log that could crash the editor.

### Changed
- **Process isolation is now by workspace folder, and the server NEVER kills another process** (`[SERVER-NO-KILL]`). The "port auto-kill on startup" behavior added in 0.4.0 is **removed**.
- **One server per folder** (`[SERVER-SINGLE-INSTANCE]`): a second start in the same folder exits immediately with `Too Many Cooks is already running in this folder`, guarded by a `.too_many_cooks/server.lock` file (`[SERVER-LOCKFILE]`).
- **Port conflicts step aside cleanly** (`[SERVER-PORT-CONFLICT]`): an `EADDRINUSE` now produces a graceful non-zero exit instead of killing the port owner. Use a distinct `TMC_PORT` per folder to run several at once.
- **All per-workspace state (database, logs, lock) lives under `${workspace}/.too_many_cooks/`** (`[SERVER-STATE-ISOLATION]`).

### Hardened
- A broken `stdout`/`stderr` pipe can no longer loop into the logger and balloon the log file (`[SERVER-EPIPE]`).

## 0.4.0

### Added
- Streamable HTTP transport (renamed from SSE)
- Port auto-kill on startup — server reclaims port 4040 if previously occupied
- 232 integration tests with 94% statement coverage
- Pure logic test suite for VSCode extension with 98.6% coverage

### Fixed
- Notification drops under concurrent agent load

### Changed
- Renamed SSE references to Streamable HTTP throughout codebase and docs

## 0.3.0

### Added
- Admin tool with `delete_lock`, `delete_agent`, and `reset_key` actions
- Subscription system for real-time notifications
- 96 integration tests with comprehensive coverage

### Improved
- Enhanced concurrent agent coordination
- Better error messages for all tool operations
- Documentation updates for Claude Code integration

## 0.2.0

### Fixed
- Added missing shebang (`#!/usr/bin/env node`) to executable - fixes npm binary execution failure
- Added missing `@modelcontextprotocol/sdk` dependency

## 0.1.0

- Initial release
- File locking for multi-agent coordination
- Agent registration with API keys
- Inter-agent messaging with broadcast support
- Plan visibility (goals and current tasks)
- Real-time status overview
- SQLite persistence at `~/.too_many_cooks/data.db`
