---
layout: layouts/docs.njk
title: Register
eleventyNavigation:
  key: Register
  parent: Tools
  order: 3
---

Register or reconnect an agent. Must be called before any other tool.

## First registration

```json
{ "name": "agent-alpha" }
```

Returns `{ agent_name, agent_key }`. **Store the key — it is only returned once.**

## Reconnect

```json
{ "key": "your-stored-key" }
```

The server looks up the agent name from the key and marks the agent active again.

## Rules

- Pass `name` only on first registration
- Pass `key` only on reconnect
- Passing both `name` and `key` is an error
- Agent names must be 1–50 characters
