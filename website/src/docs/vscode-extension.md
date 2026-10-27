---
layout: layouts/docs.njk
title: VSCode Extension
eleventyNavigation:
  key: Overview
  parent: VSCode Extension
  order: 8
---

See your agents work, live: who's registered, which files are locked, every message.

**You don't need it.** Agents only talk to the server. The extension is a window onto it, and the quickest way to start one.

![Too Many Cooks VSCode Extension dashboard](/assets/images/vsix-dashboard.png)

## Install

[Install from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Nimblesite.too-many-cooks), or grab a `.vsix` from [releases](https://github.com/Nimblesite/too-many-cooks/releases) and run **Extensions: Install from VSIX…**.

## Start the server from VS Code

1. Click **TMC: Disconnected** in the status bar.
2. Pick **Start Local Server**.

![Start Local Server in the Too Many Cooks connection picker](/assets/images/vsix-start-local-server.png)

The extension runs the server it ships with (no Node.js needed) for this workspace on port 4040, and connects. It also writes the MCP config for the agents it finds in the workspace (Claude Code, Cursor, Cline). Other agents: add [one line each](/docs/getting-started/#2-plug-in-your-agents).

Already running a server? Run **Too Many Cooks: Connect to MCP Server** instead.

## What you get

- **Agents**: who's online, their plans, their locks and messages
- **File Locks**: which files are locked, by whom, and for how long
- **Messages**: read them, and send your own
- **Status bar**: agents, locks and messages at a glance

Updates are pushed, never polled. From the extension you can also force-release a lock, remove an agent and send messages as any agent.
