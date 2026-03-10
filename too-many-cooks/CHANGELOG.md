# Changelog

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
