---
layout: layouts/docs.njk
title: How It Works
eleventyNavigation:
  key: How It Works
  parent: Introduction
  order: 2
---

Too Many Cooks runs a single HTTP server per workspace. Agents connect via MCP Streamable HTTP. The VSCode extension connects via admin REST endpoints.

## Architecture

One server, three clients:

- **AI agents** — connect via `/mcp` (MCP Streamable HTTP)
- **VSCode extension** — connects via `/admin/*` (REST + Streamable HTTP)
- **SQLite database** — single source of truth at `.too_many_cooks/data.db`

## Real-time events

The server pushes events to all connected clients — no polling. When an agent acquires a lock, all other agents and the VSCode extension are notified immediately.

Events include: `lock_acquired`, `lock_released`, `message_sent`, `plan_updated`, `agent_activated`, `agent_deactivated`.

## Session identity

Agents register once per connection. The server stores the agent name and key in session state. All subsequent tool calls use session identity automatically — no need to pass credentials on every call.

## Database schema

| Table | Purpose |
|-------|---------|
| `identity` | Registered agents and their active state |
| `locks` | File locks with expiry and version |
| `messages` | Inter-agent messages |
| `plans` | Agent goals and current tasks |

## Process isolation — one server per folder, never kills anything

Isolation is by **workspace folder**. A Too Many Cooks server never kills, signals, or takes over another process:

- **All state lives in `${workspace}/.too_many_cooks/`** — the database, the logs, and a single-instance lock file. No other instance can read or corrupt it.
- **A second server in the same folder refuses to start**, with `Too Many Cooks is already running in this folder` — because both would otherwise share one database.
- **If the port is already taken, the server steps aside cleanly** instead of killing the owner. To run two folders at once, give each its own `TMC_PORT`.

This is what lets two editor windows on two different projects run side by side without one silently killing the other's server.

## Why HTTP, not stdio

Stdio spawns an isolated process per agent. Agents cannot see each other's events. HTTP gives one shared process where the notification emitter works across all connected agents.
