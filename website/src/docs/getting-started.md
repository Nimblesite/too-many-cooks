---
layout: layouts/docs.njk
title: Getting Started
eleventyNavigation:
  key: Getting Started
  parent: Introduction
  order: 1
---

Too Many Cooks is an MCP server that lets multiple AI agents coordinate when editing the same codebase. Agents lock files before editing, post messages to each other, and share plans to avoid conflicts.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later

## Install and start the server

Install globally and start:

```bash
npm install -g too-many-cooks
too-many-cooks
```

Or run without installing:

```bash
npx too-many-cooks
```

The server starts on `http://localhost:4040` with two endpoints:

- `/mcp` — MCP Streamable HTTP endpoint for AI agents
- `/admin/*` — REST + event stream for the VSCode extension

To use a different port, set the `TMC_PORT` environment variable:

```bash
TMC_PORT=5050 too-many-cooks
```

To target a specific workspace:

```bash
TMC_WORKSPACE=/path/to/your/project too-many-cooks
```

## Upgrade

If you installed globally, update all TMC packages to the latest version:

```bash
npm update -g too-many-cooks @too-many-cooks/core
```

## Connect your AI agent

Start the server first, then point your agent at it. Too Many Cooks uses Streamable HTTP transport so all agents connect to the same running server.

### Claude Code

```bash
claude mcp add --transport http too-many-cooks http://localhost:4040/mcp
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "too-many-cooks": {
      "url": "http://localhost:4040/mcp"
    }
  }
}
```

### Cline

In VS Code, open **Cline MCP Settings** and add:

```json
{
  "mcpServers": {
    "too-many-cooks": {
      "url": "http://localhost:4040/mcp"
    }
  }
}
```

### Codex

```bash
codex --mcp-server http://localhost:4040/mcp
```

### Any MCP client

Any client that supports [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) can connect to `http://localhost:4040/mcp`.

## Install the VSCode extension

The companion VSCode extension gives you a live dashboard of agents, locks, messages, and plans. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Nimblesite.too-many-cooks) or download the `.vsix` from the [GitHub releases page](https://github.com/MelbourneDeveloper/too-many-cooks/releases).

The extension connects to the server on port 4040 automatically. If you changed the server port with `TMC_PORT`, update the extension setting `tooManyCooks.port` to match.

## Agent workflow

1. **Register** — Call `register` with your agent name. You get a key back — store it.
2. **Check status** — Call `status` to see what other agents are doing.
3. **Lock before editing** — Call `lock acquire` on any file before you edit it.
4. **Unlock when done** — Call `lock release` after you finish editing.
5. **Communicate** — Use `message send` to tell other agents what you're doing.
6. **Share your plan** — Use `plan update` so others can see your intent.

## Example CLAUDE.md rules

Add to your project's `CLAUDE.md` so agents coordinate automatically:

```markdown
## Multi-Agent Coordination (Too Many Cooks)
- Register on TMC immediately. Keep your key — do not lose it.
- If disconnected, reconnect by calling register with only your key.
- Check messages regularly, lock files before editing, unlock after.
- Don't edit locked files; signal intent via plans and messages.
```
