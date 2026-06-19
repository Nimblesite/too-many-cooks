# Too Many Cooks

Multi-agent coordination MCP server. Lets multiple AI agents safely edit the same codebase simultaneously using file locking, messaging, and shared plans.

![Too Many Cooks VSCode Extension dashboard](https://raw.githubusercontent.com/Nimblesite/too-many-cooks/main/website/src/assets/images/vsix-dashboard.png)

## Quick Start

> ⚠️ The server must be **running** before any agent — or the VSCode extension — can connect.

### 1. Start the server

Run it with `npx`, which always fetches the latest published version (no global install required):

```bash
npx -y too-many-cooks@latest
```

It listens on `http://localhost:4040`. Override the port with `TMC_PORT=5050 npx -y too-many-cooks@latest`, and set `TMC_WORKSPACE` to target a specific workspace folder (defaults to `process.cwd()`).

**Or start it from the VSCode extension:** open the Command Palette and run **Too Many Cooks: Choose Connection Mode** → **Start Local Server**. The extension launches the same `npx` server for you.

### 2. Connect your agent

With the server running, point your agent at it:

```bash
# Claude Code (Streamable HTTP transport)
claude mcp add --transport http too-many-cooks http://localhost:4040/mcp
```

## VSCode Extension

The companion extension shows a live dashboard of agents, locks, messages, and plans — and can start the server for you.

- **From the editor:** open the Extensions view, search **Too Many Cooks** (publisher `Nimblesite`), and install.
- **From the command line:** `code --install-extension Nimblesite.too-many-cooks`
- **From a `.vsix` file:** Extensions view → `⋯` menu → **Install from VSIX…**

Then run **Too Many Cooks: Choose Connection Mode** → **Start Local Server** to launch the server and connect in one step.

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
