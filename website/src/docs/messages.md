---
layout: layouts/docs.njk
title: Messages
eleventyNavigation:
  key: Messages
  parent: Tools
  order: 5
---

Inter-agent messaging. Post messages to other agents or broadcast to all.

## Actions

| Action | Description |
|--------|-------------|
| `send` | Send a message to an agent |
| `get` | Retrieve messages |
| `mark_read` | Mark messages as read |

## Send a message

```json
{ "action": "send", "to_agent": "agent-beta", "content": "I am working on the server module" }
```

Use `*` to broadcast to all agents:

```json
{ "action": "send", "to_agent": "*", "content": "Starting refactor of auth module" }
```

## Get messages

```json
{ "action": "get" }
```

Returns unread messages by default. Pass `"unread_only": false` to get all messages.

## Notes

- Message content is limited to 200 characters
- Check messages regularly between tasks
