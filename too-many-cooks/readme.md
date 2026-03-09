# Too Many Cooks

Multi-agent coordination MCP server. Enables multiple AI agents to safely edit a codebase simultaneously with file locking, messaging, shared plans, and real-time push notifications.

Uses [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) transport so all agents connect to one shared server and receive real-time state changes. No polling. Built with TypeScript on Node.js.

## Install

```bash
npm install -g too-many-cooks
```

## Start the Server

```bash
too-many-cooks
```

The server starts on **port 4040** and exposes:
- `http://localhost:4040/mcp` - MCP Streamable HTTP endpoint (for agents)
- `http://localhost:4040/admin/*` - Admin REST + event stream (for the VSCode extension)

Set `TMC_WORKSPACE` to target a specific workspace folder (defaults to `process.cwd()`):

```bash
TMC_WORKSPACE=/path/to/your/project too-many-cooks
```

Or with npx (no global install):

```bash
npx too-many-cooks
```
`
## Configure Your AI Agent

Too Many Cooks uses **Streamable HTTP** transport, not stdio. All agents connect to the same running server over HTTP so they can see each other's locks, messages, and plans in real-time. Start the server first, then point your agent at it.

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

### Any MCP Client

Any client that supports [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) can connect:

```
Endpoint: http://localhost:4040/mcp
Transport: Streamable HTTP
```

## VSCode Extension

The companion [Too Many Cooks VSCode extension](https://github.com/MelbourneDeveloper/too_many_cooks) provides a live dashboard showing agents, file locks, and messages. It connects to the same server on port 4040 automatically.

## Features

- **File Locking** - advisory locks prevent agents from editing the same files
- **Agent Identity** - secure registration with API keys
- **Messaging** - inter-agent communication with broadcast support
- **Plan Visibility** - share goals and current tasks across agents
- **Real-time Notifications** - server pushes state changes to all connected agents via Streamable HTTP
- **Written in TypeScript** - runs on Node.js

## MCP Tools

### `register`

Register a new agent or reconnect an existing one. Returns a secret key on first call - store it!

- **New agent**: `{ name: "my-agent" }` - returns `{ agent_name, agent_key }`
- **Reconnect**: `{ key: "your-stored-key" }` - resumes session with existing identity

### `lock`

Advisory file locks to prevent conflicting edits.

| Action | Description |
|--------|-------------|
| `acquire` | Lock a file for exclusive editing |
| `release` | Release your lock on a file |
| `force_release` | Release an expired lock held by another agent |
| `renew` | Extend your lock's expiry |
| `query` | Check if a specific file is locked |
| `list` | List all active locks |

### `message`

Inter-agent communication. Use `*` as `to_agent` to broadcast to all agents.

| Action | Description |
|--------|-------------|
| `send` | Send a message to an agent or broadcast |
| `get` | Read messages (unread only by default) |
| `mark_read` | Mark a message as read |

### `plan`

Share what you're working on so other agents can coordinate.

| Action | Description |
|--------|-------------|
| `update` | Set your goal and current task |
| `get` | View a specific agent's plan |
| `list` | View all agents' plans |

### `status`

System overview of all agents, locks, plans, and recent messages. No authentication required.

## Real-Time Notifications

The server pushes events to all connected agents automatically via Streamable HTTP. Agents receive notifications when:

- An agent registers or disconnects
- A file lock is acquired, released, or renewed
- A message is sent
- A plan is updated

No polling. The server pushes to every connected client in real-time.

## Example CLAUDE.md Rules

```markdown
## Multi-Agent Coordination (Too Many Cooks)
- Register on TMC immediately. Keep your key! It's critical. Do not lose it!
- If disconnected, reconnect by calling register with ONLY your key
- Check messages regularly, lock files before editing, unlock after
- Don't edit locked files; signal intent via plans and messages
- Do not use Git unless asked by user
```

## Architecture

Single HTTP server per workspace. All agents connect over Streamable HTTP to the same process.

```
+-----------------+     +-----------------+     +-----------------+
|   Claude Code   |     |      Cline      |     |     Cursor      |
+--------+--------+     +--------+--------+     +--------+--------+
         |                       |                       |
         +--- Streamable HTTP ---+--- Streamable HTTP ---+
                                 |
                                 v
                  +--------------------------+
                  |   Too Many Cooks Server  |
                  |  http://localhost:4040    |
                  |                          |
                  |  /mcp    - agent endpoint|
                  |  /admin  - VSIX endpoint |
                  +------------+-------------+
                               |
                               v
                  +--------------------------+
                  |  .too_many_cooks/data.db  |
                  +--------------------------+
```

## License

MIT
