# Too Many Cooks

Multi-agent coordination MCP server. Lets multiple AI agents safely edit the same codebase simultaneously using file locking, messaging, and shared plans.

## Packages

| Package | Description |
|---------|-------------|
| [too_many_cooks](too_many_cooks/) | MCP server + data layer (Dart/Node.js) |
| [too_many_cooks_vscode_extension](too_many_cooks_vscode_extension/) | VSCode extension for visualizing agent coordination |

## Quick Start

```bash
npm install -g too-many-cooks
claude mcp add --transport stdio too-many-cooks -- too-many-cooks
```

## Documentation

[too-many-cooks.dev](https://melbournedeveloper.github.io/too_many_cooks)

## License

MIT
