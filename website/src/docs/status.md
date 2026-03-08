---
layout: layouts/docs.njk
title: Status
eleventyNavigation:
  key: Status
  parent: Tools
  order: 7
---

Get a full overview of the current coordination state. No authentication required.

## Call

```json
{}
```

## Returns

- All registered agents and their active state
- All current file locks
- All agent plans
- Recent messages

## Use this to orient yourself

Call `status` when you first connect to understand what other agents are doing before you start work.
