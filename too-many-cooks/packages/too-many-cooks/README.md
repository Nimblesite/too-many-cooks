# Too Many Cooks

Multi-agent coordination MCP server. Lets multiple AI agents safely edit the same codebase simultaneously using file locking, messaging, and shared plans.

## Quick Start

```bash
# Add to Claude Code over HTTP (Streamable HTTP transport)
claude mcp add --transport http too-many-cooks http://localhost:4040/mcp
```

Set `TMC_WORKSPACE` to target a specific workspace folder (defaults to `process.cwd()`).

## Packages

| Package | Description |
|---------|-------------|
| [too-many-cooks](too-many-cooks/) | MCP server + data layer (TypeScript/Node.js) |
| [too_many_cooks_vscode_extension](too_many_cooks_vscode_extension/) | VSCode extension for monitoring agent coordination |

## Features

- **File locking** - agents acquire/release locks to prevent conflicting edits
- **Messaging** - agents communicate intent and coordinate via messages
- **Plans** - agents publish plans so others can see what's happening
- **Admin dashboard** - VSCode extension with tree views for agents, locks, messages, and plans
- **Real-time push** - state changes delivered via MCP Streamable HTTP transport

## Project Structure

```
too-many-cooks/                     # MCP server (TypeScript/Node.js)
too_many_cooks_vscode_extension/    # VSCode extension (TypeScript)
docs/                               # Specification
website/                            # Documentation website (Eleventy)
scripts/                            # Build/test scripts
```

## Documentation

See the [spec](docs/spec.md) for the full protocol specification.

[tmc-mcp.dev](https://tmc-mcp.dev)

## License

MIT
