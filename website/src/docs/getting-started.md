---
layout: layouts/docs.njk
title: Getting Started
eleventyNavigation:
  key: Getting Started
  parent: Introduction
  order: 1
---

Too Many Cooks lets AI agents share one codebase. They lock files, share plans and message each other, so nobody overwrites anybody.

## 1. Start the server

```bash
npm install -g too-many-cooks && too-many-cooks
```

No install: `npx -y too-many-cooks@latest`. Needs [Node.js](https://nodejs.org/) 18+.

**Or from VS Code, no Node.js:** install the [extension](https://marketplace.visualstudio.com/items?itemName=Nimblesite.too-many-cooks), click **TMC: Disconnected** in the status bar, pick **Start Local Server**. [How →](/docs/vscode-extension/#start-the-server-from-vs-code)

It listens on `http://localhost:4040`: agents use `/mcp`, the VS Code extension uses `/admin`.

| Variable | Default | Sets |
| --- | --- | --- |
| `TMC_PORT` | `4040` | the port |
| `TMC_WORKSPACE` | current folder | the workspace it coordinates |

> **One server per folder.** State lives in that folder's `.too_many_cooks/`. A second start in the same folder exits; a taken port is never stolen. Two projects at once? Give each its own `TMC_PORT`.

Upgrade: `npm update -g too-many-cooks`.

## 2. Plug in your agents

```bash
claude mcp add --transport http too-many-cooks http://localhost:4040/mcp
codex mcp add too-many-cooks --url http://localhost:4040/mcp
pi mcp add too-many-cooks --url http://localhost:4040/mcp
```

**Cursor** (`.cursor/mcp.json`) and **Cline** (MCP Settings):

```json
{
  "mcpServers": {
    "too-many-cooks": { "url": "http://localhost:4040/mcp" }
  }
}
```

Anything else: point a [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) MCP client at `http://localhost:4040/mcp`.

## 3. Watch it live (optional)

Agents only need the server. The [VS Code extension](https://marketplace.visualstudio.com/items?itemName=Nimblesite.too-many-cooks) is a window onto it: agents, locks, messages, live. It connects to port 4040; changed the port? Set `tooManyCooks.port` to match.

## 4. Tell your agents the rules

Add to `CLAUDE.md` or `AGENTS.md`:

```markdown
## Multi-Agent Coordination (Too Many Cooks)
- Register on TMC immediately. Keep your key — do not lose it.
- If disconnected, reconnect by calling register with only your key.
- Check messages regularly, lock files before editing, unlock after.
- Don't edit locked files; signal intent via plans and messages.
```
