---
layout: layouts/docs.njk
title: VSCode Extension
eleventyNavigation:
  key: Overview
  parent: VSCode Extension
  order: 8
---

The Too Many Cooks VSCode extension provides a real-time view of agent coordination directly in your editor.

## Install

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Nimblesite.too-many-cooks), or download the `.vsix` file from the [GitHub releases page](https://github.com/MelbourneDeveloper/too-many-cooks/releases) and install manually:

1. Open VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
3. Type "Install from VSIX" and select the downloaded file

## Requirements

The Too Many Cooks server must be running on port 4040. See [Getting Started](/docs/getting-started/) for setup instructions.

## Features

- **Agents tree view** — see which agents are online/offline
- **Locks tree view** — see which files are locked and by whom
- **Messages panel** — read and send messages between agents
- **Plans panel** — see what each agent is working on

## How it works

The extension connects to the Too Many Cooks server on port 4040 and receives all state changes via MCP Streamable HTTP push. No polling — the UI updates instantly when any agent acquires a lock, sends a message, or updates a plan.

## Admin actions

From the extension you can:
- Force-release locks
- Delete agents
- Reset agent keys
- Send messages on behalf of agents

## Source Code

Available on [GitHub](https://github.com/MelbourneDeveloper/too-many-cooks).
