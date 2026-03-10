<div align="center">

<img src="https://raw.githubusercontent.com/MelbourneDeveloper/too-many-cooks/main/website/src/assets/images/tmclogo.png" alt="Too Many Cooks" width="120">

<h1 style="font-family:'JetBrains Mono','SF Mono','Fira Code',monospace;letter-spacing:-0.02em;color:#1a1a1a;">Too Many Cooks</h1>

<p style="font-size:1.125rem;color:#4a4440;max-width:560px;margin:0 auto 1.5rem;">
Multi-agent coordination MCP server for AI agents editing the same codebase simultaneously.
</p>

[![npm](https://img.shields.io/npm/v/too-many-cooks?style=flat&color=c46d3b&label=npm)](https://www.npmjs.com/package/too-many-cooks)
[![License: MIT](https://img.shields.io/badge/license-MIT-3b9b8f)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-1a1a1a)](https://nodejs.org)

<br>

<a href="https://toomanycooks.dev/docs/getting-started/" style="display:inline-block;padding:0.5rem 2rem;background:#c46d3b;color:#fff;font-family:'JetBrains Mono',monospace;font-size:0.875rem;font-weight:500;text-decoration:none;letter-spacing:0.02em;border:1px solid #c46d3b;">Get Started</a>&nbsp;&nbsp;
<a href="https://toomanycooks.dev" style="display:inline-block;padding:0.5rem 2rem;background:transparent;color:#1a1a1a;font-family:'JetBrains Mono',monospace;font-size:0.875rem;font-weight:500;text-decoration:none;letter-spacing:0.02em;border:1px solid #b0a99f;">Documentation</a>&nbsp;&nbsp;
<a href="https://www.npmjs.com/package/too-many-cooks" style="display:inline-block;padding:0.5rem 2rem;background:transparent;color:#1a1a1a;font-family:'JetBrains Mono',monospace;font-size:0.875rem;font-weight:500;text-decoration:none;letter-spacing:0.02em;border:1px solid #b0a99f;">npm</a>

</div>

<br>

---

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">Quick Start</h2>

```bash
npx too-many-cooks
```

Or install globally:

```bash
npm install -g too-many-cooks
too-many-cooks
```

The server starts on **port 4040** and exposes:

<table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
<thead>
<tr style="border-bottom:2px solid #b0a99f;">
<th align="left" style="padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#7b756f;">Endpoint</th>
<th align="left" style="padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#7b756f;">Purpose</th>
</tr>
</thead>
<tbody>
<tr style="border-bottom:1px solid #d6d0c8;">
<td style="padding:0.75rem 1rem;"><code style="padding:0.15em 0.4em;background:#ece7e0;border:1px solid #d6d0c8;color:#c46d3b;font-size:0.85em;">http://localhost:4040/mcp</code></td>
<td style="padding:0.75rem 1rem;color:#4a4440;">MCP Streamable HTTP endpoint (for agents)</td>
</tr>
<tr style="border-bottom:1px solid #d6d0c8;">
<td style="padding:0.75rem 1rem;"><code style="padding:0.15em 0.4em;background:#ece7e0;border:1px solid #d6d0c8;color:#c46d3b;font-size:0.85em;">http://localhost:4040/admin/*</code></td>
<td style="padding:0.75rem 1rem;color:#4a4440;">Admin REST + event stream (for the VSCode extension)</td>
</tr>
</tbody>
</table>

<br>

<h3 style="font-weight:700;letter-spacing:-0.02em;">Environment Variables</h3>

<table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
<thead>
<tr style="border-bottom:2px solid #b0a99f;">
<th align="left" style="padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#7b756f;">Variable</th>
<th align="left" style="padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#7b756f;">Default</th>
<th align="left" style="padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#7b756f;">Description</th>
</tr>
</thead>
<tbody>
<tr style="border-bottom:1px solid #d6d0c8;">
<td style="padding:0.75rem 1rem;"><code style="color:#c46d3b;">TMC_PORT</code></td>
<td style="padding:0.75rem 1rem;color:#4a4440;"><code>4040</code></td>
<td style="padding:0.75rem 1rem;color:#4a4440;">Server port</td>
</tr>
<tr style="border-bottom:1px solid #d6d0c8;">
<td style="padding:0.75rem 1rem;"><code style="color:#c46d3b;">TMC_WORKSPACE</code></td>
<td style="padding:0.75rem 1rem;color:#4a4440;"><code>process.cwd()</code></td>
<td style="padding:0.75rem 1rem;color:#4a4440;">Target workspace folder</td>
</tr>
</tbody>
</table>

```bash
TMC_PORT=5050 TMC_WORKSPACE=/path/to/project too-many-cooks
```

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">Connect Your Agent</h2>

Too Many Cooks uses [**Streamable HTTP**](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) transport. All agents connect to the same running server so they see each other's locks, messages, and plans in real-time.

<table style="width:100%;border-collapse:collapse;">
<tr>
<td width="50%" valign="top" style="padding:1rem;">

<h3>Claude Code</h3>

```bash
claude mcp add \
  --transport http \
  too-many-cooks \
  http://localhost:4040/mcp
```

</td>
<td width="50%" valign="top" style="padding:1rem;">

<h3>Codex</h3>

```bash
codex --mcp-server \
  http://localhost:4040/mcp
```

</td>
</tr>
<tr>
<td valign="top" style="padding:1rem;">

<h3>Cursor</h3>

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "too-many-cooks": {
      "url": "http://localhost:4040/mcp"
    }
  }
}
```

</td>
<td valign="top" style="padding:1rem;">

<h3>Cline</h3>

Add via **Cline MCP Settings** in VSCode:

```json
{
  "mcpServers": {
    "too-many-cooks": {
      "url": "http://localhost:4040/mcp"
    }
  }
}
```

</td>
</tr>
</table>

Any client that supports [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) can connect to `http://localhost:4040/mcp`.

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">MCP Tools</h2>

<table style="width:100%;border-collapse:collapse;">
<tr>
<td style="padding:1.5rem;background:#faf8f5;border:1px solid #d6d0c8;border-left:3px solid #c46d3b;">

<h3 style="font-family:'JetBrains Mono',monospace;font-weight:600;margin-bottom:0.5rem;"><code style="color:#c46d3b;">register</code></h3>

Register a new agent or reconnect with an existing key. Returns a secret key on first call &mdash; **store it**.

| Input | Output |
|:------|:-------|
| `{ name: "my-agent" }` | `{ agent_name, agent_key }` |
| `{ key: "your-key" }` | Resumes existing session |

</td>
</tr>
<tr><td style="height:0.5rem;border:none;"></td></tr>
<tr>
<td style="padding:1.5rem;background:#faf8f5;border:1px solid #d6d0c8;border-left:3px solid #c46d3b;">

<h3 style="font-family:'JetBrains Mono',monospace;font-weight:600;margin-bottom:0.5rem;"><code style="color:#c46d3b;">lock</code></h3>

Advisory file locks to prevent conflicting edits.

| Action | Description |
|:-------|:------------|
| `acquire` | Lock a file for exclusive editing |
| `release` | Release your lock on a file |
| `force_release` | Release an expired lock held by another agent |
| `renew` | Extend your lock's expiry |
| `query` | Check if a specific file is locked |
| `list` | List all active locks |

</td>
</tr>
<tr><td style="height:0.5rem;border:none;"></td></tr>
<tr>
<td style="padding:1.5rem;background:#faf8f5;border:1px solid #d6d0c8;border-left:3px solid #c46d3b;">

<h3 style="font-family:'JetBrains Mono',monospace;font-weight:600;margin-bottom:0.5rem;"><code style="color:#c46d3b;">message</code></h3>

Inter-agent communication. Use `*` as `to_agent` to broadcast.

| Action | Description |
|:-------|:------------|
| `send` | Send a message to an agent or broadcast |
| `get` | Read messages (unread only by default) |
| `mark_read` | Mark a message as read |

</td>
</tr>
<tr><td style="height:0.5rem;border:none;"></td></tr>
<tr>
<td style="padding:1.5rem;background:#faf8f5;border:1px solid #d6d0c8;border-left:3px solid #c46d3b;">

<h3 style="font-family:'JetBrains Mono',monospace;font-weight:600;margin-bottom:0.5rem;"><code style="color:#c46d3b;">plan</code></h3>

Share what you're working on so other agents can coordinate.

| Action | Description |
|:-------|:------------|
| `update` | Set your goal and current task |
| `get` | View a specific agent's plan |
| `list` | View all agents' plans |

</td>
</tr>
<tr><td style="height:0.5rem;border:none;"></td></tr>
<tr>
<td style="padding:1.5rem;background:#faf8f5;border:1px solid #d6d0c8;border-left:3px solid #c46d3b;">

<h3 style="font-family:'JetBrains Mono',monospace;font-weight:600;margin-bottom:0.5rem;"><code style="color:#c46d3b;">status</code></h3>

System overview of all agents, locks, plans, and recent messages. No authentication required.

</td>
</tr>
</table>

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">Real-Time Notifications</h2>

The server pushes events to all connected agents via Streamable HTTP. Agents receive notifications when:

- An agent registers or disconnects
- A file lock is acquired, released, or renewed
- A message is sent
- A plan is updated

No polling. The server pushes to every connected client in real-time.

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">VSCode Extension</h2>

The companion [**Too Many Cooks VSCode extension**](https://github.com/MelbourneDeveloper/too-many-cooks) provides a live dashboard showing agents, file locks, messages, and plans. It connects to the same server on port 4040 automatically.

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">Architecture</h2>

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

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">Example CLAUDE.md Rules</h2>

```markdown
## Multi-Agent Coordination (Too Many Cooks)
- Register on TMC immediately. Keep your key! It's critical. Do not lose it!
- If disconnected, reconnect by calling register with ONLY your key
- Check messages regularly, lock files before editing, unlock after
- Don't edit locked files; signal intent via plans and messages
- Do not use Git unless asked by user
```

<br>

<div align="center" style="padding:1.5rem 0;border-top:1px solid #d6d0c8;">
<p style="font-size:0.875rem;color:#7b756f;">MIT License &copy; 2026 <a href="https://www.nimblesite.co">Nimblesite Pty Ltd</a></p>
</div>
