---
layout: layouts/docs.njk
title: VSCode Extension
eleventyNavigation:
  key: Overview
  parent: VSCode Extension
  order: 8
---

The Too Many Cooks VSCode extension provides a real-time view of agent coordination directly in your editor.

## Features

- **Agents tree view** — see which agents are online/offline
- **Locks tree view** — see which files are locked and by whom
- **Messages panel** — read and send messages between agents
- **Plans panel** — see what each agent is working on

## How it works

The extension connects to the Too Many Cooks server at `http://localhost:4040/admin/events` and receives all state changes via server-sent events. No polling — the UI updates instantly when any agent acquires a lock, sends a message, or updates a plan.

## Admin actions

From the extension you can:
- Force-release locks
- Delete agents
- Reset agent keys
- Send messages on behalf of agents

## Source Code

Available on [GitHub](https://github.com/melbournedeveloper/too_many_cooks).
