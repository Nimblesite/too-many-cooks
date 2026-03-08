---
layout: layouts/docs.njk
title: Lock
eleventyNavigation:
  key: Lock
  parent: Tools
  order: 4
---

Advisory file locking. Lock a file before editing, release when done.

## Actions

| Action | Description |
|--------|-------------|
| `acquire` | Lock a file path |
| `release` | Release your lock |
| `renew` | Extend lock expiry |
| `force_release` | Release an expired lock (any agent) |
| `query` | Check if a specific file is locked |
| `list` | List all active locks |

## Acquire a lock

```json
{ "action": "acquire", "file_path": "lib/src/server.dart" }
```

## Release a lock

```json
{ "action": "release", "file_path": "lib/src/server.dart" }
```

## Notes

- Locks expire after 10 minutes by default
- `force_release` only works on expired locks
- `query` and `list` require no authentication
- Locks use optimistic concurrency (version column) to prevent races
