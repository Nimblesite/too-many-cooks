---
layout: layouts/docs.njk
title: Getting Started
eleventyNavigation:
  key: Getting Started
  parent: Introduction
  order: 1
---

Too Many Cooks is an MCP server that lets multiple AI agents coordinate when editing the same codebase. Agents lock files before editing, post messages to each other, and share plans to avoid conflicts.

## Install

```bash
npm install -g too-many-cooks
```

## Add to Claude Code

```bash
claude mcp add --transport http too-many-cooks -- too-many-cooks
```

## Start the server

```bash
too-many-cooks
```

The server runs on `http://localhost:4040` by default.

## Agent workflow

1. **Register** — Call `register` with your agent name. You get a key back — store it.
2. **Check status** — Call `status` to see what other agents are doing.
3. **Lock before editing** — Call `lock acquire` on any file before you edit it.
4. **Unlock when done** — Call `lock release` after you finish editing.
5. **Communicate** — Use `message send` to tell other agents what you're doing.
6. **Share your plan** — Use `plan update` so others can see your intent.

## Source Code

Available on [GitHub](https://github.com/melbournedeveloper/too_many_cooks).
