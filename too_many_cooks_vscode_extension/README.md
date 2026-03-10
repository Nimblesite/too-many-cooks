<div align="center">

<img src="https://raw.githubusercontent.com/MelbourneDeveloper/too-many-cooks/main/website/src/assets/images/tmclogo.png" alt="Too Many Cooks" width="120">

<h1 style="font-family:'JetBrains Mono','SF Mono','Fira Code',monospace;letter-spacing:-0.02em;color:#1a1a1a;">Too Many Cooks — VSCode Extension</h1>

<p style="font-size:1.125rem;color:#4a4440;max-width:560px;margin:0 auto 1.5rem;">
Real-time dashboard for monitoring and managing multi-agent coordination.
</p>

[![Version](https://img.shields.io/badge/version-0.4.0-c46d3b)](https://github.com/MelbourneDeveloper/too-many-cooks)
[![License: MIT](https://img.shields.io/badge/license-MIT-3b9b8f)](LICENSE)
[![VSCode](https://img.shields.io/badge/vscode-%3E%3D1.85-1a1a1a)](https://code.visualstudio.com)

<br>

See which AI agents are active, what files are locked,<br>
and what messages are being exchanged — all from your editor.

<br>

<a href="https://toomanycooks.dev/docs/getting-started/" style="display:inline-block;padding:0.5rem 2rem;background:#c46d3b;color:#fff;font-family:'JetBrains Mono',monospace;font-size:0.875rem;font-weight:500;text-decoration:none;letter-spacing:0.02em;border:1px solid #c46d3b;">Get Started</a>&nbsp;&nbsp;
<a href="https://toomanycooks.dev" style="display:inline-block;padding:0.5rem 2rem;background:transparent;color:#1a1a1a;font-family:'JetBrains Mono',monospace;font-size:0.875rem;font-weight:500;text-decoration:none;letter-spacing:0.02em;border:1px solid #b0a99f;">Documentation</a>

</div>

<br>

---

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">Requirements</h2>

The [**Too Many Cooks MCP server**](https://www.npmjs.com/package/too-many-cooks) must be running. Install and start it:

```bash
npx too-many-cooks
```

Or install globally:

```bash
npm install -g too-many-cooks
too-many-cooks
```

The server starts on `http://localhost:4040`. To use a different port:

```bash
TMC_PORT=5050 npx too-many-cooks
```

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">Connect Your AI Agents</h2>

Each agent connects to the MCP server via [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http). Start the server first, then point your agent at it.

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

<h3>Cursor</h3>

`.cursor/mcp.json`:

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
<tr>
<td valign="top" style="padding:1rem;">

<h3>Cline</h3>

Add via **Cline MCP Settings**:

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

<h3>Codex</h3>

```bash
codex --mcp-server \
  http://localhost:4040/mcp
```

</td>
</tr>
</table>

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">Install the Extension</h2>

Install from a `.vsix` file or the VSCode marketplace. The extension auto-connects to the server on port 4040.

If the server runs on a non-default port:

<table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
<thead>
<tr style="border-bottom:2px solid #b0a99f;">
<th align="left" style="padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#7b756f;">Setting</th>
<th align="left" style="padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#7b756f;">Default</th>
<th align="left" style="padding:0.75rem 1rem;font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#7b756f;">Description</th>
</tr>
</thead>
<tbody>
<tr style="border-bottom:1px solid #d6d0c8;">
<td style="padding:0.75rem 1rem;"><code style="color:#c46d3b;">tooManyCooks.port</code></td>
<td style="padding:0.75rem 1rem;color:#4a4440;"><code>4040</code></td>
<td style="padding:0.75rem 1rem;color:#4a4440;">MCP server port</td>
</tr>
</tbody>
</table>

```json
{
  "tooManyCooks.port": 5050
}
```

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">Features</h2>

<table style="width:100%;border-collapse:collapse;">
<tr>
<td style="padding:1.5rem;background:#faf8f5;border:1px solid #d6d0c8;border-left:3px solid #c46d3b;">

<h3 style="font-family:'JetBrains Mono',monospace;font-weight:600;">Agents Tree View</h3>

See which agents are online and active in the sidebar.

</td>
<td style="width:0.5rem;border:none;"></td>
<td style="padding:1.5rem;background:#faf8f5;border:1px solid #d6d0c8;border-left:3px solid #c46d3b;">

<h3 style="font-family:'JetBrains Mono',monospace;font-weight:600;">File Locks Tree View</h3>

See which files are locked and by whom. Expired locks are highlighted.

</td>
</tr>
<tr><td style="height:0.5rem;border:none;" colspan="3"></td></tr>
<tr>
<td style="padding:1.5rem;background:#faf8f5;border:1px solid #d6d0c8;border-left:3px solid #c46d3b;">

<h3 style="font-family:'JetBrains Mono',monospace;font-weight:600;">Messages Panel</h3>

Read inter-agent messages in real-time as they arrive.

</td>
<td style="width:0.5rem;border:none;"></td>
<td style="padding:1.5rem;background:#faf8f5;border:1px solid #d6d0c8;border-left:3px solid #c46d3b;">

<h3 style="font-family:'JetBrains Mono',monospace;font-weight:600;">Plans Panel</h3>

See what each agent is working on, their goals and current tasks.

</td>
</tr>
<tr><td style="height:0.5rem;border:none;" colspan="3"></td></tr>
<tr>
<td style="padding:1.5rem;background:#faf8f5;border:1px solid #d6d0c8;border-left:3px solid #c46d3b;">

<h3 style="font-family:'JetBrains Mono',monospace;font-weight:600;">Admin Commands</h3>

Force-release locks, delete agents, reset keys, send messages from the command palette.

</td>
<td style="width:0.5rem;border:none;"></td>
<td style="padding:1.5rem;background:#faf8f5;border:1px solid #d6d0c8;border-left:3px solid #c46d3b;">

<h3 style="font-family:'JetBrains Mono',monospace;font-weight:600;">Real-Time Updates</h3>

State changes arrive via MCP Streamable HTTP push. No polling.

</td>
</tr>
</table>

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">How It Works</h2>

<div style="padding:1rem 1.5rem;border-left:3px solid #c46d3b;background:rgba(196,109,59,0.08);">

- Communicates with the TMC server via `/admin/*` REST endpoints
- Receives real-time state changes via MCP Streamable HTTP push (no polling)
- Does **not** access the database directly

</div>

<br>

<h2 style="font-weight:700;letter-spacing:-0.02em;padding-bottom:0.5rem;border-bottom:2px solid #c46d3b;">Build &amp; Test</h2>

```bash
# Build the VSIX
bash scripts/vsix.sh build

# Install from source
bash scripts/vsix.sh install

# Run tests
npm test

# Run pure logic tests with coverage
npm run test:coverage
```

<br>

<div align="center" style="padding:1.5rem 0;border-top:1px solid #d6d0c8;">
<p style="font-size:0.875rem;color:#7b756f;">MIT License &copy; 2026 <a href="https://www.nimblesite.co">Nimblesite Pty Ltd</a></p>
</div>
