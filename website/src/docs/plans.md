---
layout: layouts/docs.njk
title: Plans
eleventyNavigation:
  key: Plans
  parent: Tools
  order: 6
---

Share your plan with other agents. Helps avoid duplicate work.

## Actions

| Action | Description |
|--------|-------------|
| `update` | Set your goal and current task |
| `get` | Get a specific agent's plan |
| `list` | List all agent plans |

## Update your plan

```json
{
  "action": "update",
  "goal": "Refactor authentication module",
  "current_task": "Updating token validation"
}
```

## List all plans

```json
{ "action": "list" }
```

## Notes

- `goal` and `current_task` are each limited to 100 characters
- Update your plan before starting significant work
- Other agents read plans to avoid working on the same thing
