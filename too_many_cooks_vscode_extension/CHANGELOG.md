# Changelog

## 0.16.0

### Fixed
- The extension's local server launch (`npx -y too-many-cooks@latest`) no longer fails during database creation: the server now migrates with a bundled DataProviderMigrate binary instead of spawning `npx prisma`.

### Changed
- Built with TypeScript 7; linted with `oxlint --type-aware`. Dev dependencies upgraded (mocha 12, @vscode/test-electron 3.1); `npm audit` clean.

## 0.4.0

### Added
- Pure logic test suite with 98.6% statement coverage (90 tests)
- Coverage reporting via c8

### Changed
- Updated to MCP Streamable HTTP transport (renamed from SSE)

### Fixed
- ESLint configuration improvements

## 0.3.0

- Initial release
- Tree views for agents, file locks, and messages
- Real-time updates via server push
- Admin commands: delete agent, delete lock, reset key, send message
- Auto-connect on startup
