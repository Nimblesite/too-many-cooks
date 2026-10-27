---
layout: layouts/blog.njk
title: "Too Many Cooks 0.16: The Server Just Starts"
description: "Too Many Cooks stops AI agents clobbering each other's code. 0.16 makes it start first time on every machine, and puts the server inside the VS Code extension."
date: 2026-10-27
author: Christian Findlay
category: releases
tags: [release]
---

**Too Many Cooks** lets Claude Code, Codex, pi and any other MCP agent work on one codebase at the same time. Agents lock a file before they edit it, share their plans and message each other. Nobody overwrites anybody.

0.16 is about one thing: it starts. First time, on every machine.

## What we fixed

- **First start on a clean machine.** The server could fail while it created its database. Now the database is ready in about a second, on macOS, Linux and Windows.
- **Windows.** The extension launched the server through `npx`, which died with `spawn npx ENOENT`. It now runs its own bundled server instead.
- **The Codex connect line.** Our docs showed a flag that never existed. Every agent now has one line that works.
- **A deleted logs folder** no longer crashes the server.

## What's new

- **The server ships inside the VS Code extension.** One build per platform, no Node.js needed. Click **TMC: Disconnected**, pick **Start Local Server**, done.
- **Versions always match.** The extension checks the server's version before it runs it.
- **Configurable limits** for message and plan length.

## Get it

Agents only need the server. The extension is optional: it's your window into the kitchen.

```bash
npm install -g too-many-cooks && too-many-cooks
```

```bash
claude mcp add --transport http too-many-cooks http://localhost:4040/mcp
codex mcp add too-many-cooks --url http://localhost:4040/mcp
pi mcp add too-many-cooks --url http://localhost:4040/mcp
```

[Install the VS Code extension](https://marketplace.visualstudio.com/items?itemName=Nimblesite.too-many-cooks), or [watch the 76-second walkthrough](/).
